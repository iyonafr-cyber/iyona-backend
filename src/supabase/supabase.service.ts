import { Injectable, Logger } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';
import {
  ISupabaseService,
  ProvisionProjectInput,
  ProvisionedProject,
  SupabaseMigration,
  MigrationApplyResult,
} from './interface/supabase.interface';
import { secureRandomPassword } from '../common/secure-random';
import { SupabasePostgresService } from './supabase-postgres.service';
import { describeSqlTarget, type SqlTarget } from './sql-target';

/**
 * Thin client over the Supabase Management API
 * (https://api.supabase.com). Called by `ProjectsService` when a user
 * opts into `withDatabase` at project create time.
 *
 * Feature-flagged on `SUPABASE_MGMT_TOKEN` so non-prod environments
 * can still exercise the project create flow end-to-end without a
 * live Supabase org. When the flag is missing we return a deterministic
 * stub config and mark the project's supabase block as `failed` with a
 * helpful message; the owner can still see in the admin panel that
 * provisioning never ran.
 *
 * The service intentionally does NOT persist anything itself — it
 * returns the provisioned credentials and lets `ProjectsService` decide
 * how to encrypt + store them via `EncryptionService`.
 */
@Injectable()
export class SupabaseService implements ISupabaseService {
  private readonly logger = new Logger(SupabaseService.name);
  private readonly httpClient: AxiosInstance | null;
  private readonly orgId: string | undefined;
  private readonly defaultRegion: string;

  constructor(private readonly postgres: SupabasePostgresService) {
    const token = process.env.SUPABASE_MGMT_TOKEN;
    this.orgId = process.env.SUPABASE_ORG_ID || undefined;
    this.defaultRegion = process.env.SUPABASE_DEFAULT_REGION || 'us-east-1';

    if (!token || !this.orgId) {
      this.httpClient = null;
      this.logger.warn(
        'SUPABASE_MGMT_TOKEN / SUPABASE_ORG_ID not set — `withDatabase` ' +
          'project requests will be marked failed but allowed through.',
      );
      return;
    }

    this.httpClient = axios.create({
      baseURL: 'https://api.supabase.com',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      timeout: 30_000,
    });
  }

  isEnabled(): boolean {
    return this.httpClient !== null;
  }

  async provisionProject(
    input: ProvisionProjectInput,
  ): Promise<ProvisionedProject> {
    if (!this.httpClient || !this.orgId) {
      // Stub path — surfaces a clearly-fake project ref so anyone
      // inspecting the DB knows this never hit the live API. The
      // caller marks the supabase block `failed` with a guiding
      // message so the user understands why their app has no DB.
      throw new Error(
        'Supabase Management API is not configured (missing SUPABASE_MGMT_TOKEN / SUPABASE_ORG_ID).',
      );
    }

    const region = input.region || this.defaultRegion;
    const plan = input.plan || 'free';
    // The Management API requires a strong DB password. Generate one
    // we don't keep — callers can rotate it later via the dashboard.
    const dbPassword = generateRandomPassword(40);

    try {
      const createResp = await this.httpClient.post('/v1/projects', {
        organization_id: this.orgId,
        name: input.name,
        region,
        plan,
        db_pass: dbPassword,
      });

      const projectRef = createResp.data?.id as string | undefined;
      if (!projectRef) {
        throw new Error('Supabase create project response missing `id`');
      }

      // The keys endpoint is only reliably populated AFTER the project
      // finishes spinning up (~60-120s). Poll up to 3 minutes.
      const keys = await this.pollForApiKeys(projectRef);

      const anonKey = keys.find((k) => k.name === 'anon')?.api_key;
      const serviceRoleKey = keys.find(
        (k) => k.name === 'service_role',
      )?.api_key;

      if (!anonKey || !serviceRoleKey) {
        throw new Error(
          `Supabase project ${projectRef} ready but anon/service_role keys missing`,
        );
      }

      return {
        projectRef,
        url: `https://${projectRef}.supabase.co`,
        anonKey,
        serviceRoleKey,
        region,
        stub: false,
      };
    } catch (err) {
      const message = err?.response?.data?.message || err.message;
      this.logger.error(`Supabase provision failed: ${message}`);
      throw new Error(message || 'Supabase provisioning failed');
    }
  }

  /**
   * Create (or update the password of) a user in the PROJECT's own Supabase
   * Auth, via its Auth Admin API — not the Management API. Supabase hashes the
   * password; Jarvis never stores it.
   *
   * `email_confirm: true` skips the verification email: the owner is creating
   * this account deliberately from Project settings, and a generated app has
   * no mail transport configured to complete a confirmation round-trip.
   */
  async upsertAuthUser(input: {
    projectRef: string;
    serviceRoleKey: string;
    email: string;
    password: string;
  }): Promise<{ id: string; created: boolean }> {
    const { projectRef, serviceRoleKey, email, password } = input;
    const base = `https://${projectRef}.supabase.co/auth/v1`;
    const headers = {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      'Content-Type': 'application/json',
    };

    try {
      const resp = await axios.post(
        `${base}/admin/users`,
        { email, password, email_confirm: true },
        { headers, timeout: 30_000 },
      );
      return { id: resp.data?.id as string, created: true };
    } catch (err) {
      // Already registered → look the user up and reset their password so the
      // owner can always recover access from the settings panel.
      const status = err?.response?.status;
      const code = String(err?.response?.data?.error_code ?? '');
      const msg = String(
        err?.response?.data?.msg ?? err?.response?.data?.message ?? '',
      );
      const isDuplicate =
        status === 422 ||
        /already been registered|already exists/i.test(msg) ||
        code === 'email_exists';
      if (!isDuplicate) {
        this.logger.error(
          `Supabase auth user create failed for ${projectRef}: ${msg || this.errMessage(err)}`,
        );
        throw new Error(msg || 'Failed to create the admin account');
      }

      const list = await axios.get(`${base}/admin/users?page=1&per_page=200`, {
        headers,
        timeout: 30_000,
      });
      const users = (list.data?.users ?? []) as Array<{
        id: string;
        email?: string;
      }>;
      const existing = users.find(
        (u) => (u.email ?? '').toLowerCase() === email.toLowerCase(),
      );
      if (!existing) {
        throw new Error(
          'That email is already registered but could not be located to update.',
        );
      }
      await axios.put(
        `${base}/admin/users/${existing.id}`,
        { password, email_confirm: true },
        { headers, timeout: 30_000 },
      );
      return { id: existing.id, created: false };
    }
  }

  /**
   * Ensure the `public.profiles` table exists with a `role` column, RLS, and a
   * trigger that creates a row for every new auth user.
   *
   * This is what makes "admin" mean anything: without a role column, RLS can
   * only distinguish authenticated from anonymous, so an admin is
   * indistinguishable from any visitor who signs up. Idempotent.
   */
  async ensureProfilesTable(target: SqlTarget): Promise<void> {
    const sql = `
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  role text not null default 'user',
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='profiles' and policyname='profiles_self_read') then
    create policy "profiles_self_read" on public.profiles for select using (auth.uid() = id);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='profiles' and policyname='profiles_self_update') then
    create policy "profiles_self_update" on public.profiles for update using (auth.uid() = id) with check (auth.uid() = id);
  end if;
end $$;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email) values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;
`;
    await this.runSql(target, sql);
  }

  /** Promote a user to admin in `public.profiles`. Idempotent. */
  async setProfileRole(
    target: SqlTarget,
    userId: string,
    email: string,
    role: 'admin' | 'user',
  ): Promise<void> {
    const safeId = userId.replace(/'/g, "''");
    const safeEmail = email.replace(/'/g, "''");
    const safeRole = role.replace(/'/g, "''");
    await this.runSql(
      target,
      `insert into public.profiles (id, email, role)
       values ('${safeId}', '${safeEmail}', '${safeRole}')
       on conflict (id) do update set role = excluded.role, email = excluded.email;`,
    );
  }

  async deleteProject(projectRef: string): Promise<void> {
    if (!this.httpClient) return;
    try {
      await this.httpClient.delete(`/v1/projects/${projectRef}`);
    } catch (err) {
      const message = err?.response?.data?.message || err.message;
      this.logger.warn(
        `Supabase delete project ${projectRef} failed: ${message}`,
      );
    }
  }

  /**
   * Apply user-defined SQL migrations against a project's Postgres. We track
   * applied file names in a `__jarvis_migrations` ledger inside the user's
   * database so re-deploying with no schema change is a cheap no-op and we
   * never re-run a migration that already succeeded.
   *
   * Transport-agnostic (decision 07): the ledger, the ordering, and the RLS
   * gate behave identically whether the SQL goes through the Management API
   * (managed projects) or a direct Postgres connection with the owner's own
   * password (BYO projects). Both run each call in a single transaction —
   * the Management API per request, Postgres per simple-query batch — so a
   * migration that fails halfway never leaves a half-applied schema.
   */
  async applyMigrations(
    target: SqlTarget,
    migrations: SupabaseMigration[],
  ): Promise<MigrationApplyResult> {
    const result: MigrationApplyResult = {
      applied: [],
      skipped: [],
      failed: [],
    };

    if (!migrations || migrations.length === 0) return result;

    if (target.mode === 'mgmt' && !this.httpClient) {
      // Treat as skipped — caller will see all migrations as not
      // applied. The project page surfaces a "Supabase not configured"
      // banner separately, so we don't need to noisy-error here.
      result.skipped = migrations.map((m) => m.name);
      return result;
    }

    // 1) Make sure the ledger exists. Cheap and idempotent.
    try {
      await this.runSql(
        target,
        `create schema if not exists public;
         create table if not exists public.__jarvis_migrations (
           name text primary key,
           applied_at timestamptz not null default now()
         );`,
      );
    } catch (err) {
      const message = this.errMessage(err);
      this.logger.error(
        `Supabase applyMigrations: failed to ensure ledger on ${describeSqlTarget(target)}: ${message}`,
      );
      // Don't blow up the whole call — surface every migration as failed
      // so the UI can show the underlying root cause.
      result.failed = migrations.map((m) => ({ name: m.name, error: message }));
      return result;
    }

    // 2) Read the ledger so we know what to skip. Sort migrations
    // lexicographically so 0001_ runs before 0002_ even if the caller
    // didn't sort them.
    let already = new Set<string>();
    try {
      const rows = await this.runSql<{ name: string }>(
        target,
        'select name from public.__jarvis_migrations',
      );
      already = new Set(rows.map((r) => r.name));
    } catch (err) {
      const message = this.errMessage(err);
      this.logger.warn(
        `Supabase applyMigrations: could not read ledger on ${describeSqlTarget(target)} (${message}); attempting all migrations anyway`,
      );
    }

    const sorted = [...migrations].sort((a, b) => a.name.localeCompare(b.name));

    for (const migration of sorted) {
      if (already.has(migration.name)) {
        result.skipped.push(migration.name);
        continue;
      }
      const rlsViolation = findTablesMissingRls(migration.sql);
      if (rlsViolation.length > 0) {
        const message = `RLS missing on table(s): ${rlsViolation.join(', ')}. Every public-schema table must include "alter table public.<name> enable row level security" in the same migration.`;
        this.logger.warn(
          `Supabase applyMigrations: refused ${migration.name} on ${describeSqlTarget(target)}: ${message}`,
        );
        result.failed.push({ name: migration.name, error: message });
        break;
      }
      try {
        await this.runSql(target, migration.sql);
        await this.runSql(
          target,
          `insert into public.__jarvis_migrations (name) values ($jarvis$${migration.name.replace(/\$jarvis\$/g, '')}$jarvis$) on conflict do nothing`,
        );
        result.applied.push(migration.name);
      } catch (err) {
        const message = this.errMessage(err);
        this.logger.warn(
          `Supabase applyMigrations: ${migration.name} failed on ${describeSqlTarget(target)}: ${message}`,
        );
        result.failed.push({ name: migration.name, error: message });
        // Stop on first failure — subsequent migrations almost
        // certainly depend on the failed one and would just spam more
        // confusing errors at the user.
        break;
      }
    }

    return result;
  }

  /**
   * Execute arbitrary SQL against a project's Postgres, over whichever
   * transport the target names. Public so SupabaseSchemaService can use it
   * directly without the migration ledger overhead.
   *
   * `mgmt` returns `[]` when the Management API isn't configured — that
   * silence is load-bearing for the managed path (callers treat it as "not
   * provisioned"). `postgres` has no such fallback: if the owner gave us a
   * connection string and it fails, they need the error.
   */
  async runSql<T = unknown>(target: SqlTarget, sql: string): Promise<T[]> {
    if (target.mode === 'postgres') {
      return this.postgres.runSql<T>(target.connectionString, sql);
    }
    if (!this.httpClient) return [];
    const resp = await this.httpClient.post(
      `/v1/projects/${target.projectRef}/database/query`,
      { query: sql },
    );
    const data = resp.data as unknown;
    return (Array.isArray(data) ? data : []) as T[];
  }

  private errMessage(err: unknown): string {
    if (
      err &&
      typeof err === 'object' &&
      'response' in err &&
      err.response &&
      typeof err.response === 'object' &&
      'data' in err.response &&
      err.response.data &&
      typeof err.response.data === 'object' &&
      'message' in err.response.data
    ) {
      const m = (err.response.data as { message: unknown }).message;
      if (typeof m === 'string') return m;
    }
    if (err instanceof Error) return err.message;
    return 'unknown error';
  }

  /**
   * Spin until Supabase reports the project as `ACTIVE_HEALTHY` and the
   * api keys are available, or 3 minutes elapse.
   */
  private async pollForApiKeys(
    projectRef: string,
  ): Promise<Array<{ name: string; api_key: string }>> {
    if (!this.httpClient) return [];

    const deadline = Date.now() + 3 * 60_000;
    let attempt = 0;
    while (Date.now() < deadline) {
      attempt++;
      try {
        const resp = await this.httpClient.get(
          `/v1/projects/${projectRef}/api-keys`,
        );
        const keys = resp.data as Array<{ name: string; api_key: string }>;
        if (
          Array.isArray(keys) &&
          keys.some((k) => k.name === 'anon') &&
          keys.some((k) => k.name === 'service_role')
        ) {
          return keys;
        }
      } catch {
        // Project not yet ready — just keep polling.
      }

      // Exponential-ish backoff capped at 15s, jittered.
      const waitMs = Math.min(2000 * 2 ** Math.min(attempt - 1, 3), 15_000);
      await sleep(waitMs + Math.floor(Math.random() * 500));
    }
    throw new Error(
      `Supabase project ${projectRef} did not become ready within 3 minutes`,
    );
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * PR-2.C — flag any `create table public.<name>` (or `create table if
 * not exists ...`) that doesn't pair with an `alter table ... enable
 * row level security` for the same table in the same migration.
 *
 * Only `public` schema tables are checked — `auth`, `storage`,
 * extension schemas, and `private` schemas are managed by Supabase
 * or the operator and don't fall under the RLS rule for AI-generated
 * apps. Quoted identifiers (`"My Table"`) and `if not exists` are
 * both supported. The matcher is intentionally lenient: a single
 * `enable row level security` referencing the same identifier (with
 * or without the `public.` prefix) satisfies the check.
 */
export function findTablesMissingRls(sql: string): string[] {
  const tableRe =
    /\bcreate\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\s*\.\s*)?("[^"]+"|[a-zA-Z_][a-zA-Z0-9_]*)/gi;
  const tables: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = tableRe.exec(sql)) !== null) {
    const raw = match[1];
    const name = raw.startsWith('"') ? raw.slice(1, -1) : raw;
    if (!tables.includes(name)) tables.push(name);
  }
  if (tables.length === 0) return [];
  const missing: string[] = [];
  for (const name of tables) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rlsRe = new RegExp(
      `\\balter\\s+table\\s+(?:public\\s*\\.\\s*)?"?${escaped}"?\\s+enable\\s+row\\s+level\\s+security`,
      'i',
    );
    if (!rlsRe.test(sql)) missing.push(name);
  }
  return missing;
}

function generateRandomPassword(length: number): string {
  // CSPRNG-backed; the resulting password is the only credential
  // protecting the project's Postgres until Supabase rotates it.
  return secureRandomPassword(length);
}
