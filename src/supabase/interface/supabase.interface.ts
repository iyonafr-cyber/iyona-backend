import type { SqlTarget } from '../sql-target';

/**
 * Public surface of the Supabase client. Kept separate from the concrete
 * service so test doubles can satisfy the contract without wiring axios.
 *
 * `provisionProject` / `deleteProject` are Management-API-only (managed
 * projects). `applyMigrations` / `runSql` take a {@link SqlTarget} and work
 * over either transport — see decision 07.
 */
export interface ISupabaseService {
  /**
   * Whether the backend is currently configured to talk to the Supabase
   * Management API. When `false`, calls to `provisionProject` resolve
   * with a stub config so downstream flows (project create, generation)
   * keep working in dev/CI. Production deploys must set
   * `SUPABASE_MGMT_TOKEN` and `SUPABASE_ORG_ID`.
   */
  isEnabled(): boolean;

  /**
   * Create a new Supabase project under the configured org and return
   * the URL + anon + service-role keys. Long-running on Supabase's side
   * (~2 minutes); callers should not await it inside an HTTP request.
   */
  provisionProject(input: ProvisionProjectInput): Promise<ProvisionedProject>;

  /**
   * Hard-delete a Supabase project. Used when a Iyona project is
   * permanently removed by the owner or by an admin takedown.
   */
  deleteProject(projectRef: string): Promise<void>;

  /**
   * Apply one or more SQL migrations to the project's Postgres
   * database. Idempotent at the file
   * level (a `__jarvis_migrations` ledger inside the user's database
   * tracks which file names have already run) so calling this on every
   * deploy is safe and cheap when nothing changed.
   *
   * @deprecated Use SupabaseSchemaService.applySchema() for new code.
   */
  applyMigrations(
    target: SqlTarget,
    migrations: SupabaseMigration[],
  ): Promise<MigrationApplyResult>;

  /**
   * Execute arbitrary SQL against a project's Postgres, over whichever
   * transport the target names.
   */
  runSql<T = unknown>(target: SqlTarget, sql: string): Promise<T[]>;
}

export interface SupabaseMigration {
  /** Stable, sortable file name, e.g. `0001_init.sql`. */
  name: string;
  /** Raw SQL contents to execute. */
  sql: string;
}

export interface MigrationApplyResult {
  applied: string[];
  skipped: string[];
  failed: { name: string; error: string }[];
}

export interface ProvisionProjectInput {
  /** Human-readable project name; we use the Iyona project id by default. */
  name: string;
  /** Region slug — defaults to `SUPABASE_DEFAULT_REGION` env var. */
  region?: string;
  /** Optional plan id (`free`, `pro`...). Defaults to `free`. */
  plan?: 'free' | 'pro';
}

export interface ProvisionedProject {
  projectRef: string;
  url: string;
  anonKey: string;
  serviceRoleKey: string;
  region: string;
  /** True when this came from the stub fallback (no live API call). */
  stub: boolean;
}
