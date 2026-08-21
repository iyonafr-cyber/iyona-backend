import { Logger } from '@nestjs/common';
import {
  mgmtTarget,
  postgresTarget,
  type SqlTarget,
} from 'src/supabase/sql-target';
import {
  resolveSupabaseMigrationMode,
  type SupabaseMigrationMode,
  type SupabaseReadinessSnapshot,
} from './supabase-readiness';

const logger = new Logger('SupabaseSqlTarget');

export interface ResolvedSqlTarget {
  mode: SupabaseMigrationMode;
  /** Set when `mode` is `mgmt` or `postgres`; absent for `manual` / `none`. */
  target?: SqlTarget;
  /** Set when a credential existed but could not be used. */
  error?: string;
}

/**
 * Turn a project's stored Supabase config into an executable SQL target,
 * decrypting the BYO connection string when there is one.
 *
 * Kept as a free function taking a `decrypt` callback rather than a service:
 * both `RevisionsService` (deploy pipeline) and `ProjectsService` (admin
 * bootstrap) need it, they live in different modules, and neither should grow
 * a dependency on the other just to answer "where does DDL go for this
 * project".
 *
 * A connection string that fails to decrypt degrades to `manual` rather than
 * throwing — a deploy should still ship the app and tell the owner to run the
 * SQL, not fall over because a stored credential is unreadable.
 */
export function resolveSqlTarget(
  sb: SupabaseReadinessSnapshot | null | undefined,
  decrypt: (cipher: string) => string,
  projectIdForLog?: string,
): ResolvedSqlTarget {
  const mode = resolveSupabaseMigrationMode(sb);

  if (mode === 'postgres') {
    try {
      const connectionString = decrypt(sb.dbUrlEnc);
      if (!connectionString?.trim()) {
        throw new Error('decrypted connection string is empty');
      }
      return { mode, target: postgresTarget(connectionString) };
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'could not read connection string';
      logger.warn(
        `Falling back to manual migrations${
          projectIdForLog ? ` for project ${projectIdForLog}` : ''
        }: ${message}`,
      );
      return {
        mode: 'manual',
        error:
          'Stored database connection string could not be read. Re-connect your Supabase project in settings.',
      };
    }
  }

  if (mode === 'mgmt') {
    return { mode, target: mgmtTarget(sb.projectRef) };
  }

  return { mode };
}
