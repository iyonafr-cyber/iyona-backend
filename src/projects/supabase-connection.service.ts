import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import axios from 'axios';
import { UserProject } from './entities/user-project.entity';
import { ProjectAccessService } from './project-access.service';
import type { IEncryptionService } from 'src/encryption/interface/encryption.interface.service';
import { SupabasePostgresService } from 'src/supabase/supabase-postgres.service';
import {
  InvalidConnectionStringError,
  parseSupabaseConnectionString,
} from 'src/supabase/supabase-connection-string';
import { ConnectSupabaseDto } from './dto/connect-supabase.dto';
import {
  isSupabaseReadyForUse,
  resolveSupabaseMigrationMode,
  supabaseLifecycleStatus,
  type SupabaseMigrationMode,
} from './supabase-readiness';

export interface SupabaseConnectionStatus {
  status: string;
  source?: 'managed' | 'byo';
  connected: boolean;
  url?: string;
  projectRef?: string;
  /** How schema changes reach this database. */
  migrationMode: SupabaseMigrationMode;
  /** True when Jarvis can apply migrations without the owner doing anything. */
  autoMigrations: boolean;
  /** True when the app-admin feature is available (needs the service role key). */
  canManageAppAdmin: boolean;
  dbUrlKind?: string;
  connectedAt?: Date;
  error?: string;
  /** SQL the owner still needs to run by hand, if any. */
  pendingMigrationSql?: string;
  pendingMigrationAt?: Date;
}

export interface ConnectSupabaseResult extends SupabaseConnectionStatus {
  /** Non-fatal advice — wrong pooler, unrecognised host, missing optional keys. */
  warnings: string[];
}

/**
 * Connect / disconnect an owner's own Supabase project (decision 07, BYO).
 *
 * Everything here is verification-first: credentials are proven to work
 * BEFORE the project is marked `ready`. That is the whole point of the
 * endpoint. The alternative — trusting pasted strings and setting `ready` on
 * shape alone — turns a typo into a successful deploy of a silently dead app,
 * discovered hours later with no error anywhere. A failed paste should fail
 * while the owner is still looking at the form.
 */
@Injectable()
export class SupabaseConnectionService {
  private readonly logger = new Logger(SupabaseConnectionService.name);

  constructor(
    @InjectModel(UserProject.name)
    private readonly userProjectModel: Model<UserProject>,
    private readonly accessService: ProjectAccessService,
    private readonly postgres: SupabasePostgresService,
    @Inject('IEncryptionService')
    private readonly encryptionService: IEncryptionService,
  ) {}

  /**
   * Validate, verify, encrypt, and store BYO credentials, then mark the
   * project ready. Replaces the whole `supabase` block: re-connecting to a
   * different project must not leave the previous project's ref, keys, or
   * pending SQL behind.
   */
  async connect(
    projectId: string,
    userId: string,
    dto: ConnectSupabaseDto,
  ): Promise<ConnectSupabaseResult> {
    await this.accessService.requireOwnedProject(userId, projectId);

    const warnings: string[] = [];
    const { url, projectRef } = this.parseProjectUrl(dto.url);
    const anonKey = dto.anonKey.trim();
    if (!anonKey) {
      throw new BadRequestException('Anon key is required.');
    }

    // 1) Cheap, deterministic checks first — every syntax problem in the
    // pasted values is caught before we spend a network round trip. Pasting
    // the transaction pooler string is a common mistake, and making someone
    // wait on a DNS lookup and a TLS handshake to be told "wrong port" is
    // needless. It also means a syntax error is reported even when the anon
    // key is wrong too, instead of hiding behind it until the next attempt.
    const dbUrl = dto.dbUrl?.trim();
    const parsedDbUrl = dbUrl ? this.parseDbUrl(dbUrl) : null;
    if (parsedDbUrl) {
      warnings.push(...parsedDbUrl.warnings);
      if (parsedDbUrl.projectRef && parsedDbUrl.projectRef !== projectRef) {
        throw new BadRequestException(
          `The connection string points at project "${parsedDbUrl.projectRef}" but the URL is for "${projectRef}". Copy both from the same Supabase project.`,
        );
      }
    }

    // 2) Prove the URL + anon key actually address a live Supabase project.
    await this.verifyAnonKey(url, anonKey);

    // 3) Prove the connection string works, if one was given. A bad DB URL is
    // a hard failure rather than a downgrade to manual: the owner explicitly
    // asked for automatic migrations, and silently giving them something else
    // is worse than telling them the string is wrong.
    let dbUrlEnc: string | undefined;
    let dbUrlKind: string | undefined;
    if (dbUrl && parsedDbUrl) {
      const verified = await this.postgres.verifyConnection(dbUrl);
      if (!verified.ok) {
        throw new BadRequestException(
          verified.error ?? 'Could not connect to the database.',
        );
      }
      if (verified.canCreate === false) {
        throw new BadRequestException(
          'That database role cannot create objects in the "public" schema, so migrations would fail. Use the postgres role connection string from Supabase → Project Settings → Database.',
        );
      }
      dbUrlEnc = this.encryptionService.encrypt(dbUrl);
      dbUrlKind = parsedDbUrl.kind;
    } else {
      warnings.push(
        'No database connection string provided — Jarvis will generate SQL for schema changes and you run it in the Supabase SQL editor.',
      );
    }

    // 4) Service role key is optional and unlocks exactly one thing.
    let serviceRoleKeyEnc: string | undefined;
    const serviceRoleKey = dto.serviceRoleKey?.trim();
    if (serviceRoleKey) {
      serviceRoleKeyEnc = this.encryptionService.encrypt(serviceRoleKey);
    } else {
      warnings.push(
        "No service role key provided — creating the generated app's admin account from Project settings is unavailable.",
      );
    }

    const connectedAt = new Date();
    await this.userProjectModel
      .updateOne(
        { _id: projectId },
        {
          $set: {
            supabase: {
              projectRef,
              url,
              source: 'byo',
              anonKey: undefined,
              anonKeyEnc: this.encryptionService.encrypt(anonKey),
              serviceRoleKeyEnc,
              dbUrlEnc,
              dbUrlKind,
              status: 'ready',
              connectedAt,
              readyAt: connectedAt,
              provisioningError: null,
            },
          },
        },
      )
      .exec();

    // Audit trail, deliberately without key material.
    this.logger.log(
      `Supabase connected for project ${projectId} by user ${userId}: ref=${projectRef} ` +
        `dbUrl=${dbUrlEnc ? (dbUrlKind ?? 'yes') : 'no'} serviceRole=${serviceRoleKeyEnc ? 'yes' : 'no'}`,
    );

    const status = await this.getStatus(projectId, userId);
    return { ...status, warnings };
  }

  /**
   * Clear stored credentials. Deliberately does NOT touch the owner's Supabase
   * project — disconnecting is a Jarvis-side action, and deleting someone
   * else's database because they unlinked it would be indefensible.
   */
  async disconnect(
    projectId: string,
    userId: string,
  ): Promise<SupabaseConnectionStatus> {
    await this.accessService.requireOwnedProject(userId, projectId);

    await this.userProjectModel
      .updateOne(
        { _id: projectId },
        { $set: { supabase: { status: 'none', source: 'byo' } } },
      )
      .exec();

    this.logger.log(
      `Supabase disconnected for project ${projectId} by user ${userId}`,
    );
    return this.getStatus(projectId, userId);
  }

  async getStatus(
    projectId: string,
    userId: string,
  ): Promise<SupabaseConnectionStatus> {
    await this.accessService.requireViewer(userId, projectId);
    const project = await this.userProjectModel
      .findById(projectId)
      .select('supabase')
      .lean()
      .exec();
    const sb = project?.supabase;

    // Derive `autoMigrations` from the resolved mode rather than re-deriving it
    // from the raw fields. An earlier version did the latter and reported
    // `autoMigrations: true` on a project that was not connected at all, while
    // `migrationMode` correctly said 'none' — the settings page would have
    // promised automatic migrations for a database it could not reach. One
    // source of truth means the two cannot disagree.
    const migrationMode = resolveSupabaseMigrationMode(sb);

    return {
      status: supabaseLifecycleStatus(sb),
      source: sb?.source,
      connected: isSupabaseReadyForUse(sb),
      url: sb?.url,
      projectRef: sb?.projectRef,
      migrationMode,
      autoMigrations: migrationMode === 'postgres' || migrationMode === 'mgmt',
      canManageAppAdmin: Boolean(sb?.serviceRoleKeyEnc),
      dbUrlKind: sb?.dbUrlKind,
      connectedAt: sb?.connectedAt,
      error: sb?.provisioningError ?? sb?.lastSchemaError,
      pendingMigrationSql: sb?.pendingMigrationSql,
      pendingMigrationAt: sb?.pendingMigrationAt,
    };
  }

  /**
   * Accept either the project URL or a bare ref and normalise to
   * `https://<ref>.supabase.co`. Owners paste both, plus trailing slashes and
   * the dashboard URL (`supabase.com/dashboard/project/<ref>`), so we handle
   * what people actually have on their clipboard.
   */
  private parseProjectUrl(raw: string): { url: string; projectRef: string } {
    const value = (raw ?? '').trim().replace(/\/+$/, '');
    if (!value) {
      throw new BadRequestException('Supabase project URL is required.');
    }

    const dashboard =
      /supabase\.com\/dashboard\/project\/([a-z0-9]{16,})/i.exec(value);
    if (dashboard) {
      return {
        url: `https://${dashboard[1]}.supabase.co`,
        projectRef: dashboard[1],
      };
    }

    // Bare project ref.
    if (/^[a-z0-9]{16,}$/i.test(value)) {
      return { url: `https://${value}.supabase.co`, projectRef: value };
    }

    let parsed: URL;
    try {
      parsed = new URL(value.includes('://') ? value : `https://${value}`);
    } catch {
      throw new BadRequestException(
        'Could not parse the Supabase project URL. It should look like https://abcdefghijklmnop.supabase.co',
      );
    }

    const match = /^([a-z0-9]{16,})\.supabase\.(co|in|com)$/i.exec(
      parsed.hostname,
    );
    if (!match) {
      throw new BadRequestException(
        `"${parsed.hostname}" is not a Supabase project URL. Copy the Project URL from Supabase → Project Settings → API.`,
      );
    }
    return { url: `https://${parsed.hostname}`, projectRef: match[1] };
  }

  private parseDbUrl(dbUrl: string) {
    try {
      return parseSupabaseConnectionString(dbUrl);
    } catch (err) {
      if (err instanceof InvalidConnectionStringError) {
        throw new BadRequestException(err.message);
      }
      throw err;
    }
  }

  /**
   * Confirm the anon key is valid for this project by calling PostgREST's
   * root endpoint, which every Supabase project exposes and which requires a
   * valid apikey. A wrong key returns 401 and a wrong ref fails DNS — both
   * become an actionable message instead of a broken deploy later.
   */
  private async verifyAnonKey(url: string, anonKey: string): Promise<void> {
    let status: number;
    try {
      // `validateStatus: () => true` so only transport failures throw — the
      // status code is what we actually want to inspect. PostgREST answers 200
      // with the OpenAPI doc, but some projects 404 the root while still
      // authenticating fine, so only 401/403 is treated as a bad key.
      const resp = await axios.get(`${url}/rest/v1/`, {
        headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` },
        timeout: 15_000,
        validateStatus: () => true,
      });
      status = resp.status;
    } catch (err) {
      const code =
        err && typeof err === 'object' && 'code' in err
          ? String((err as { code: unknown }).code)
          : '';
      if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
        throw new BadRequestException(
          `Could not reach ${url}. Check the project URL — the project may have been deleted or paused.`,
        );
      }
      throw new BadRequestException(
        `Could not reach ${url}: ${err instanceof Error ? err.message : 'unknown error'}`,
      );
    }

    if (status === 401 || status === 403) {
      throw new BadRequestException(
        'Supabase rejected that anon key. Copy the "anon public" key from Supabase → Project Settings → API.',
      );
    }
  }
}
