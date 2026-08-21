/**
 * Kill switch for Iyona-managed Supabase provisioning (decision 07).
 *
 * Managed provisioning creates a Supabase project per generated app inside the
 * PLATFORM org, using `SUPABASE_MGMT_TOKEN`. It works, but the free tier caps
 * active projects per org — dev hit that ceiling and every subsequent "needs a
 * database" chat failed — and it makes Iyona the owner and payer of every
 * database it creates. BYO (owner connects their own project) replaces it.
 *
 * The code stays: it is the basis of a future paid "hosted database" tier, so
 * this is a flag rather than a deletion. **Off unless explicitly enabled** —
 * an operator who sets a Management token should not silently re-enable
 * auto-provisioning as a side effect.
 *
 * Set `SUPABASE_MANAGED_PROVISIONING=true` (or `1`) to turn it back on. Note
 * that the Management token still has to be present for it to do anything;
 * this flag gates intent, `SupabaseService.isEnabled()` gates capability.
 */
export function isManagedProvisioningEnabled(): boolean {
  const raw = (process.env.SUPABASE_MANAGED_PROVISIONING ?? '')
    .trim()
    .toLowerCase();
  return raw === 'true' || raw === '1' || raw === 'yes' || raw === 'on';
}

/** Message shown when something tries to provision while the flag is off. */
export const MANAGED_PROVISIONING_DISABLED_MESSAGE =
  'Iyona no longer creates databases for you. Connect your own Supabase project ' +
  'in Project settings → Database, then continue.';
