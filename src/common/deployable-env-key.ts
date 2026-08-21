/**
 * Key-only allowlist / blocklist for Vercel deployment env — must stay in sync
 * with {@link VercelService.filterEnvVars} in `vercel.service.ts`.
 */
const ALLOWED_PREFIXES = [
  'VITE_',
  'NEXT_PUBLIC_',
  'SUPABASE_',
  'REACT_APP_',
] as const;

const BLOCKED_PREFIXES = [
  'NODE_',
  'NPM_',
  'YARN_',
  'PATH',
  'LD_',
  'DYLD_',
  '__',
  'HOME',
  'USER',
  'SHELL',
] as const;

/**
 * Server-only credentials that would otherwise sail through on an allowed
 * prefix (decision 07).
 *
 * `SUPABASE_` is allowlisted, so without this list a database password pasted
 * into the Secrets panel as `SUPABASE_DB_URL` would be injected into the
 * Vercel build environment. It would not reach a Vite bundle — Vite only
 * exposes `VITE_*` — but it would sit readable in the Vercel dashboard for
 * anyone with project access, and it WOULD reach the bundle in a Next.js app.
 * These grant DDL or bypass-RLS access to the owner's database and have no
 * legitimate reason to exist at build time.
 *
 * Exact-match on the full key, not a prefix, so an app can still define its
 * own `SUPABASE_DB_URL_DISPLAY_NAME`-style values.
 */
const BLOCKED_KEYS = new Set([
  'SUPABASE_DB_URL',
  'SUPABASE_DB_PASSWORD',
  'SUPABASE_DATABASE_URL',
  'SUPABASE_CONNECTION_STRING',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_SERVICE_KEY',
  'SUPABASE_SECRET_KEY',
  'SUPABASE_ACCESS_TOKEN',
]);

/** True if this key may appear in the raw map passed to `VercelService.filterEnvVars`. */
export function isDeployableEnvKey(key: string): boolean {
  const upperKey = key.toUpperCase();
  if (BLOCKED_KEYS.has(upperKey)) {
    return false;
  }
  if (BLOCKED_PREFIXES.some((p) => upperKey.startsWith(p))) {
    return false;
  }
  return ALLOWED_PREFIXES.some((p) => upperKey.startsWith(p));
}
