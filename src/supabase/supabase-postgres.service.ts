import { Injectable, Logger } from '@nestjs/common';
import { Client } from 'node_modules/@types/pg';
import {
  explainConnectionError,
  parseSupabaseConnectionString,
  type ParsedSupabaseConnection,
} from './supabase-connection-string';
import { redactConnectionString } from './sql-target';

/**
 * Runs SQL against a project's Postgres over a direct connection, using the
 * owner's own database password (decision 07, BYO migrations).
 *
 * This is the BYO counterpart to the Management API SQL endpoint. It exists so
 * migrations, the RLS gate, and the profiles/admin bootstrap keep working on
 * projects that live in the OWNER's Supabase org, where Iyona has no
 * Management API access at all.
 *
 * Connections are opened per call and closed in a `finally`. No pooling: DDL
 * runs at deploy time (seconds, minutes apart), a Supabase project may pause
 * between deploys, and a long-lived pool against hundreds of user databases is
 * a connection-limit problem we have no reason to take on. The cost of a fresh
 * TLS handshake per deploy is irrelevant next to the Cursor run that preceded
 * it.
 */
@Injectable()
export class SupabasePostgresService {
  private readonly logger = new Logger(SupabasePostgresService.name);

  /** Statement timeout for a single migration batch. */
  private static readonly STATEMENT_TIMEOUT_MS = 120_000;
  private static readonly CONNECT_TIMEOUT_MS = 15_000;

  /**
   * Execute SQL and return the rows of the LAST statement, matching the shape
   * `SupabaseService.runSql` returns for the Management API so callers can't
   * tell the two transports apart.
   *
   * The whole string is sent as one simple query, so Postgres runs it in a
   * single implicit transaction — a migration that fails halfway rolls back
   * rather than leaving a half-applied schema. That matches the Management
   * API's per-request transaction semantics, which the migration ledger
   * already assumes.
   */
  async runSql<T = unknown>(
    connectionString: string,
    sql: string,
  ): Promise<T[]> {
    const parsed = this.parseOrNull(connectionString);
    const client = new Client({
      connectionString,
      // Supabase terminates TLS with a certificate chain Node doesn't trust by
      // default. The connection is still encrypted; we just don't verify the
      // chain. Same posture as `psql sslmode=require` and the Supabase CLI.
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: SupabasePostgresService.CONNECT_TIMEOUT_MS,
      statement_timeout: SupabasePostgresService.STATEMENT_TIMEOUT_MS,
      application_name: 'iyona-migrations',
    });

    try {
      await client.connect();
    } catch (err) {
      // Close the half-open socket before surfacing — an unconnected Client
      // that is never ended keeps the event loop alive.
      await client.end().catch(() => undefined);
      throw new Error(explainConnectionError(err, parsed));
    }

    try {
      const result = await client.query(sql);
      // node-postgres returns an array of results for a multi-statement query
      // and a single result otherwise.
      const last = Array.isArray(result) ? result[result.length - 1] : result;
      return ((last?.rows ?? []) as T[]) ?? [];
    } finally {
      await client.end().catch((err: unknown) => {
        this.logger.warn(
          `Failed to close Postgres connection to ${redactConnectionString(connectionString)}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      });
    }
  }

  /**
   * Open a connection, confirm the credentials work, and report what the
   * server is. Used by the connect endpoint so a bad password is caught while
   * the owner is still looking at the form — rather than surfacing as a failed
   * deploy an hour later.
   */
  async verifyConnection(connectionString: string): Promise<{
    ok: boolean;
    error?: string;
    serverVersion?: string;
    /** True when the role can create objects in `public` — i.e. run migrations. */
    canCreate?: boolean;
  }> {
    const parsed = this.parseOrNull(connectionString);
    try {
      const rows = await this.runSql<{
        version: string;
        can_create: boolean;
      }>(
        connectionString,
        `select version() as version,
                has_schema_privilege(current_user, 'public', 'CREATE') as can_create;`,
      );
      const row = rows[0];
      return {
        ok: true,
        serverVersion: row?.version,
        canCreate: row?.can_create ?? false,
      };
    } catch (err) {
      return {
        ok: false,
        error:
          err instanceof Error
            ? err.message
            : explainConnectionError(err, parsed),
      };
    }
  }

  private parseOrNull(
    connectionString: string,
  ): ParsedSupabaseConnection | null {
    try {
      return parseSupabaseConnectionString(connectionString);
    } catch {
      return null;
    }
  }
}
