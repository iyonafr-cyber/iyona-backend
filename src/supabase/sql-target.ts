/**
 * Where a piece of DDL is executed.
 *
 * Jarvis has two transports to a project's Postgres and they are not
 * interchangeable:
 *
 * - `mgmt` — the Supabase Management API SQL endpoint, authenticated with the
 *   PLATFORM token (`SUPABASE_MGMT_TOKEN`). Only works for projects inside
 *   Jarvis's own Supabase org, i.e. managed provisioning (decision 07).
 * - `postgres` — a direct connection with the project owner's own database
 *   password. Works for any Supabase project, including ones Jarvis has no
 *   Management API access to. This is the BYO path.
 *
 * Everything downstream (migration ledger, RLS gate, schema apply, profiles
 * table) is transport-agnostic — it takes a target and runs SQL. That is the
 * whole reason this type exists: `applyMigrations` / `applySchema` /
 * `ensureProfilesTable` did not have to fork for BYO.
 */
export type SqlTarget =
  | { mode: 'mgmt'; projectRef: string }
  | { mode: 'postgres'; connectionString: string };

export function mgmtTarget(projectRef: string): SqlTarget {
  return { mode: 'mgmt', projectRef };
}

export function postgresTarget(connectionString: string): SqlTarget {
  return { mode: 'postgres', connectionString };
}

/** Safe-to-log identifier for a target — never includes the password. */
export function describeSqlTarget(target: SqlTarget): string {
  if (target.mode === 'mgmt') return `mgmt:${target.projectRef}`;
  return `postgres:${redactConnectionString(target.connectionString)}`;
}

/**
 * Strip the password out of a Postgres URL so it can appear in logs and error
 * messages. Falls back to a total redaction if the string doesn't parse —
 * better to log nothing useful than to leak a credential.
 */
export function redactConnectionString(raw: string): string {
  try {
    const u = new URL(raw);
    if (u.password) u.password = '***';
    return u.toString();
  } catch {
    return '<unparseable connection string>';
  }
}
