import type { SupabaseConfig } from './entities/user-project.entity';

/** Minimal supabase shape for readiness checks (lean() documents, API DTOs). */
export type SupabaseReadinessSnapshot = Pick<
  SupabaseConfig,
  | 'status'
  | 'url'
  | 'anonKey'
  | 'anonKeyEnc'
  | 'serviceRoleKeyEnc'
  | 'projectRef'
  | 'source'
  | 'dbUrlEnc'
>;

/** True when this project's database is owner-supplied rather than Jarvis-provisioned. */
export function isByoSupabase(
  sb: SupabaseReadinessSnapshot | null | undefined,
): boolean {
  return sb?.source === 'byo';
}

/**
 * True when this project has a database with the credentials deploy + the
 * Cursor agent need. Status alone is not enough — a row can be `failed` while
 * still holding keys from a partial run.
 *
 * The service-role key is required for MANAGED projects only. Jarvis
 * provisions those itself, so a missing service-role key means the run was
 * incomplete and the row is not trustworthy. For BYO the key is optional by
 * design (decision 07): it buys exactly one feature — creating the generated
 * app's admin account through the Auth Admin API — and requiring it would
 * force every owner to hand over their most dangerous API key just to deploy a
 * read-only app. Deploy and codegen only ever need the URL and the anon key.
 */
export function isSupabaseReadyForUse(
  sb: SupabaseReadinessSnapshot | null | undefined,
): boolean {
  if (!sb) return false;
  if (sb.status !== 'ready') return false;
  if (!sb.url?.trim()) return false;
  if (!isByoSupabase(sb) && !sb.serviceRoleKeyEnc?.trim()) return false;
  if (!sb.anonKeyEnc?.trim() && !sb.anonKey?.trim()) return false;
  return true;
}

/**
 * How schema changes reach this project's Postgres.
 *
 * - `mgmt` — Management API with the platform token. Managed projects only.
 * - `postgres` — direct connection with the owner's database password (BYO).
 * - `manual` — no DDL transport. Jarvis generates the SQL and the owner runs
 *   it in the Supabase SQL editor.
 * - `none` — no database at all; there is nothing to migrate.
 */
export type SupabaseMigrationMode = 'mgmt' | 'postgres' | 'manual' | 'none';

export function resolveSupabaseMigrationMode(
  sb: SupabaseReadinessSnapshot | null | undefined,
): SupabaseMigrationMode {
  if (!isSupabaseReadyForUse(sb)) return 'none';
  if (sb.dbUrlEnc?.trim()) return 'postgres';
  if (isByoSupabase(sb)) return 'manual';
  // Managed projects always have a project ref; without one there is no
  // Management API route either, so the owner has to run the SQL themselves.
  return sb.projectRef?.trim() ? 'mgmt' : 'manual';
}

export function supabaseLifecycleStatus(
  sb: SupabaseReadinessSnapshot | null | undefined,
): string {
  return sb?.status ?? 'none';
}

export function isSupabaseProvisioning(
  sb: SupabaseReadinessSnapshot | null | undefined,
): boolean {
  const status = supabaseLifecycleStatus(sb);
  return status === 'pending' || status === 'provisioning';
}
