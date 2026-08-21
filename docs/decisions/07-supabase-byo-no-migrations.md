# Decision 07 — Supabase: Bring Your Own (BYO)

**Status:** ✅ Decided and implemented (backend) — 2026-08-20  
**Author:** Engineering  
**Date:** 2026-08-20  
**Related:** E1 managed Supabase, `SupabaseProvisioningService`, `RevisionsService.applySupabaseSchemaForRevision`, dev EC2 Supabase 2-project limit incident


---

## ✅ Outcome — what was actually decided and built (2026-08-20)

The proposal below was **Option A (BYO, no migrations)**. Review changed it in one
important way: **BYO keeps migrations**, over a different transport.

### The change

Option B assumed the only way to run DDL on a user-owned project was a Supabase
personal access token. It isn't. The owner can paste a **Postgres connection
string**, and Jarvis runs migrations directly with `node-postgres`. That is
strictly better than a PAT:

| | PAT (Option B) | DB connection string (shipped) |
|---|---|---|
| Blast radius | The owner's whole Supabase account | Exactly one database |
| Rotation UX | Needed | Owner rotates in Supabase; re-paste |
| Familiarity | "What is a PAT?" | Copy button in the dashboard |

So the "AI builds your backend" story survives BYO, which was Option A's main cost.

### Shipped shape

**One code path with a capability flag**, not two modes. `SqlTarget` is the seam —
the migration ledger, the RLS gate, the schema pipeline, and the profiles/admin
bootstrap are all transport-agnostic and were not forked.

| Owner provides | Result |
|---|---|
| URL + anon key (required) | App deploys and runs. This is "connected". |
| + DB connection string (optional) | Jarvis applies schema changes automatically. |
| + service role key (optional) | Jarvis can create the app's admin account. |
| No connection string | Jarvis renders the SQL; owner runs it in the SQL editor. |

Three migration modes, resolved per project by `resolveSupabaseMigrationMode`:
`postgres` (BYO with connection string) → `mgmt` (legacy managed) → `manual`
(copy-paste script parked on `supabase.pendingMigrationSql`).

### Answers to the open questions below

| # | Question | Answer |
|---|---|---|
| 2 | Service role key required for BYO? | **No.** Its only consumer is `setAppAdmin`. Optional; its absence disables exactly that feature. |
| 5 | Agent output for schema changes? | Both. `__schema__.json` as before; rendered to SQL for the owner when there is no DDL transport. |
| 6 | Remove managed provisioning? | **Gate, don't delete** — it is the basis of a future paid tier. `SUPABASE_MANAGED_PROVISIONING`, off by default. |

Still open: 1 (paid tier), 3 (existing managed projects on dev), 4 (mid-chat UX
copy), 7 (enterprise), 8 (naming).

### Backend delivered

- `SqlTarget` seam + `SupabasePostgresService` (direct DDL, per-call connections)
- `POST/DELETE /projects/:id/supabase/connect`, extended `GET .../supabase/status`
- **Verification before `ready`**: anon key checked against PostgREST, connection
  string opened and checked for `CREATE` on `public`. A typo fails at the form,
  not as a silently dead deploy.
- Connection-string classification: rejects the transaction pooler (6543, no
  multi-statement DDL), warns that the direct host is IPv6-only from EC2
- `SUPABASE_DB_URL` and friends blocked from Vercel build env (`SUPABASE_` was
  allowlisted, so a pasted password would otherwise have been injected)
- Managed provisioning dormant behind a flag; `/supabase/provision` answers 410
- Cursor prompt tells the agent when schema is owner-applied, so generated pages
  handle a not-yet-created table with an empty state rather than a crash
- 29 tests; `spec-build`'s 3-minute provisioning wait skipped when the flag is off

### Frontend still to do

1. Project Settings → Database: connect form (URL, anon key, optional DB string
   and service role key), status, warnings, disconnect
2. Pending-SQL panel with copy button, driven by `pendingMigrationSql`
3. Replace the mid-chat provisioning spinner — branch on the new
   `databaseAction: 'connect' | 'provision'` field instead of polling a status
   that will never change
4. Project create: repurpose the `withDatabase` toggle (en + fr locale strings)
5. App-admin page: show why it is unavailable when the service role key is absent

### Not addressed

Read-only schema introspection (`GET /rest/v1/` returns the table list with just
the anon key) would let Jarvis warn "your code queries `posts`, your DB has no
`posts`" before deploy. Worth doing next — it is what makes the manual mode
non-mysterious.

---

## Problem

Jarvis today **auto-provisions** a Supabase project per generated app via the **Supabase Management API**, using a single platform org (`SUPABASE_MGMT_TOKEN` + `SUPABASE_ORG_ID`). That model works for demos but breaks in production:

1. **Supabase Free tier caps active projects at 2** per admin account across all orgs. Dev hit this limit (`jarvis.software.co@gmail.com`) — new provisions fail with “2 active free projects”.
2. **Every new “needs database” chat** can trigger another provision attempt until the org is full.
3. **Platform cost & liability** — Jarvis owns every DB, every org quota, and every failed provision UX.
4. **Competitive reference** — [Lovable](https://docs.lovable.dev/integrations/supabase) uses Supabase under the hood but offers **Lovable Cloud** (platform-managed) *or* **Connect your own Supabase**. We currently only mirror the managed path.

We need a product/engineering decision: how should Jarvis handle Supabase going forward, especially on dev/UAT and for builders who already have (or prefer) their own Supabase account?

---

## Current Jarvis architecture (as shipped)

### Provisioning (managed only)

| Component | Role |
|-----------|------|
| `SupabaseProvisioningService` | Creates project via Management API, encrypts keys, sets `supabase.status` |
| `POST /projects/:id/supabase/provision` | Mid-chat / manual kickoff |
| `detectAndProvisionDatabase()` | AI detects DB need from initial prompt |
| Workspace DB gate (`workspace.controller.ts`) | Blocks chat until `isSupabaseReadyForUse()` when prompt needs DB |
| Mongo `UserProject.supabase` | `projectRef`, `url`, `anonKeyEnc`, `serviceRoleKeyEnc`, `status`, errors |

Readiness requires: `status === 'ready'`, `url`, `anonKeyEnc` (or legacy `anonKey`), **`serviceRoleKeyEnc`**.

### Deploy / runtime

| Component | Role |
|-----------|------|
| `RevisionsService.buildSupabaseBuildEnv()` | Injects `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` into Vercel build |
| `mergeProjectDeployBuildEnv()` | Platform Supabase env **overrides** user secrets on key collision |
| Cursor job prompt enrichment | Tells agent DB exists; emit `__schema__.json` for schema changes |

### Migrations / schema (automatic today)

On each revision/deploy, `applySupabaseSchemaForRevision()`:

1. **Primary:** Parse `__schema__.json` from generated files → `SupabaseSchemaService.applySchema()` (JSON → SQL, RLS enforced).
2. **Legacy:** Scan `supabase/migrations/*.sql` → `SupabaseService.applyMigrations()` with ledger `public.__jarvis_migrations`.

Both execute SQL via **Management API** `POST /v1/projects/{ref}/database/query` using **Jarvis platform token** — not the user’s anon/service keys.

### Other DB features tied to Management API + service role

| Feature | Mechanism |
|---------|-----------|
| App admin account (`setAppAdmin`) | `ensureProfilesTable()` + `setProfileRole()` via **mgmt SQL**; `upsertAuthUser()` via **service role Auth Admin API** |
| RLS gate on migrations | `findTablesMissingRls()` refuses migrations without `ENABLE ROW LEVEL SECURITY` |

### What does **not** exist today

- No “Connect Supabase” API or settings UI
- No per-project Management API token
- Project secrets (`.env.example` → `appBuildSecretsEnc`) can hold `VITE_SUPABASE_*` but **do not** integrate with DB gate, migrations, or admin setup

---

## Proposal under discussion: BYO Supabase only, no Jarvis migrations

**Summary:** User creates their own Supabase project, pastes credentials into Jarvis project settings. Jarvis treats the DB as **ready** for code generation and deploy env injection. Jarvis **does not** run schema migrations or call the Management API for that project.

### User provides

| Field | Required | Stored | Used for |
|-------|----------|--------|----------|
| Project URL (`https://<ref>.supabase.co`) | Yes | `supabase.url` | Deploy env, agent context |
| Project ref (`<ref>`) | Yes (derivable from URL) | `supabase.projectRef` | Linking, future features |
| Anon key | Yes | `supabase.anonKeyEnc` | Deploy env, client |
| Service role key | **TBD** — see open questions | `supabase.serviceRoleKeyEnc` | Admin auth API only (if kept) |

Optional flag: `supabase.source: 'byo' | 'managed'` (managed = legacy auto-provision).

### Jarvis behavior for BYO projects

| Behavior | BYO (`source: 'byo'`) |
|----------|------------------------|
| Auto-provision on create / mid-chat | **Disabled** |
| DB gate | Pass when URL + anon key present (service role TBD) |
| `applySupabaseSchemaForRevision` | **Skipped entirely** |
| Cursor agent schema instruction | **No `__schema__.json` requirement**; optional `supabase/setup.sql` in repo as owner-run documentation |
| Deploy env injection | Unchanged — from `supabase` block |
| Management API calls for that project | **None** |

### Schema ownership

- **User** creates tables, RLS, storage buckets, Auth settings in Supabase dashboard (or their own CLI).
- Agent generates **frontend/backend code** that assumes existing schema, or outputs SQL files the user runs manually.
- Chat prompts like “add a blog table” produce **code + optional SQL file**, not an applied migration.

---

## Options

### A. BYO only, no migrations (this proposal) — recommended v1

**Effort:** ~1 sprint (backend connect endpoint, encrypt storage, disable provision paths, skip schema apply, settings UI, agent prompt tweaks).

**Pros:**
- Immediately escapes **2-project free limit** — each builder uses their own Supabase quota/billing.
- No per-user OAuth or Management API token storage.
- Minimal new security surface (same key types we already encrypt).
- Aligns with Lovable’s “connect your own project” path (minus Lovable’s migration UX).
- Can ship while managed provisioning stays behind a feature flag or is removed from dev.

**Cons:**
- **Weaker “AI builds the backend” story** — schema is manual unless user runs SQL themselves.
- **App admin / profiles / roles** partially broken unless user pre-creates `public.profiles` + RLS (today’s `setAppAdmin` runs SQL via mgmt API).
- **Seed data** from `__schema__.json` `sql` field no longer auto-inserts.
- **RLS safety net** (Jarvis refuses migrations without RLS) no longer applies — user must secure their DB.
- Two code paths if we keep managed mode anywhere (`source: 'byo' | 'managed'`).

---

### B. BYO + user Management API token (migrations on BYO)

User connects Supabase **and** provides a personal access token (PAT) with access to their project. Jarvis runs migrations against **their** project using **their** token.

**Effort:** ~1.5–2 sprints (OAuth or PAT UI, per-project mgmt client, token rotation, error UX).

**Pros:**
- Full Lovable-like “chat creates tables” on user-owned projects.
- Keeps `__schema__.json` pipeline and RLS enforcement.

**Cons:**
- Storing user PATs is sensitive; rotation/revocation UX required.
- OAuth with Supabase is nicer but more work than a PAT text field.
- Users may not understand what a PAT is.

---

### C. Keep managed provisioning + upgrade Supabase org to Pro

Pay ~$25/mo for unlimited active projects on Jarvis’s org; keep current migration/admin flows unchanged.

**Effort:** Low (billing + ops).

**Pros:**
- Zero product change; migrations/admin keep working.
- Best UX for non-technical builders.

**Cons:**
- Jarvis pays and owns every DB; abuse/cost scales with usage.
- Doesn’t help builders who want data in **their** org/compliance boundary.
- Still a single point of failure if org token is misconfigured.

---

### D. Hybrid (recommended long term if we keep both audiences)

| Audience | Path |
|----------|------|
| Default / dev / power users | **BYO, no migrations** (Option A) |
| “Jarvis Cloud DB” tier (paid) | Managed + migrations (Option C or B) |

**Effort:** Option A now; Option C/B as paid add-on later.

---

### E. BYO via project secrets only (no `supabase` block changes)

User puts `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` in Secrets panel from `.env.example`.

**Not recommended.**

- DB gate still tries to auto-provision.
- Migrations never run (same as A) but agent doesn’t get Supabase context.
- Platform env merge may override or conflict with user secrets.
- No single “DB connected” signal for UX.

---

## Comparison matrix

| Criterion | Managed (today) | BYO no migrations (A) | BYO + PAT migrations (B) | Pro org (C) |
|-----------|-----------------|------------------------|----------------------------|-------------|
| Escapes 2-project limit | No | **Yes** | **Yes** | Yes (for our org) |
| Chat → auto schema | Yes | **No** | Yes | Yes |
| User owns data/compliance | No | **Yes** | **Yes** | No |
| Mgmt API token per user | No | No | **Yes** | No |
| Implementation effort | Done | **~1 sprint** | ~1.5–2 sprints | Low |
| App admin from Jarvis settings | Yes | **Partial** | Yes | Yes |
| RLS enforced by Jarvis | Yes | **No** | Yes | Yes |

---

## What works vs breaks (BYO no migrations)

### Works

- Generated app using `@supabase/supabase-js` with injected env vars
- Supabase Auth in the client (if enabled in user’s project)
- Supabase Storage (if buckets exist)
- Cursor agent writing queries/mutations against **existing** tables
- Deploy to Vercel with Supabase env
- No dependency on Jarvis org project quota

### Breaks or degrades

| Feature | Impact | Mitigation |
|---------|--------|------------|
| Auto table creation from chat | Gone | Document “run SQL in dashboard”; optional `supabase/setup.sql` in repo |
| Seed data inserts via schema | Gone | Agent uses empty states; user seeds manually |
| `setAppAdmin` + `public.profiles` + role | Broken without SQL runner | Disable for BYO; or document required setup SQL; or Auth-only admin without roles |
| Mid-chat “provision database” UX | Remove / replace with “Connect Supabase” | New settings panel |
| `withDatabase` toggle on project create | Repurpose or remove | “I’ll connect Supabase later” vs auto-provision |
| Admin panel Supabase schema view | Empty / stale | Show “BYO — schema managed in Supabase dashboard” |

---

## Proposed implementation scope (Option A)

### Backend

1. **`POST /projects/:id/supabase/connect`** (owner/admin)
   - Body: `url`, `anonKey`, optional `serviceRoleKey`
   - Validate URL shape, derive `projectRef`
   - Encrypt keys; set `status: 'ready'`, `source: 'byo'`, `readyAt`
   - Optional: `DELETE` / disconnect clears credentials

2. **`GET /projects/:id/supabase/status`** — extend with `source`, `connected: boolean`

3. **Disable managed provisioning** (config flag or remove on dev)
   - `startSupabaseProvisioning`, `detectAndProvisionDatabase`, workspace provision kickoff
   - Return 410 or redirect message: “Connect your Supabase in Settings”

4. **`isSupabaseReadyForUse()`** — for BYO, relax `serviceRoleKeyEnc` requirement if we drop admin features (open question)

5. **`applySupabaseSchemaForRevision`** — early return when `supabase.source === 'byo'`

6. **Cursor prompts** — branch on BYO:
   - Do not require `__schema__.json`
   - May add `supabase/setup.sql` as owner documentation
   - Warn: tables must exist or app will error at runtime

### Frontend

1. **Project Settings → Database** — connect form (URL, anon key, optional service role), status, link to Supabase dashboard
2. **Remove/replace** provision spinner and “Setting up your database…” mid-chat flow → “Connect Supabase to continue”
3. **Create project** — remove “With database” auto-provision; optional “Use Supabase (connect in settings)”
4. **Admin app admin UI** — hide or show prerequisite SQL for BYO

### Ops / env

- `SUPABASE_MGMT_TOKEN` / `SUPABASE_ORG_ID` become **optional** on instances that are BYO-only
- Document operator setup: no platform Supabase org required for dev

### Tests

- `supabase-readiness` with BYO snapshot
- Connect endpoint validation + encryption
- Revision deploy skips schema apply for BYO
- Workspace gate passes when BYO ready, does not call provision

---

## Security & compliance notes

- **Anon key** in Vite bundle is expected (same as today).
- **Service role key** must never reach the client; keep server-only encrypted field.
- BYO means **Jarvis is not the data processor** for Postgres contents — user’s Supabase ToS applies. Update Jarvis docs/ToS accordingly.
- Without Jarvis RLS enforcement, misconfigured user DBs are possible; consider in-app warning: “Ensure RLS is enabled on all public tables.”
- Audit: log connect/disconnect events (no key material).

---

## Open questions for senior / founder

1. **Is BYO-only acceptable as the default**, or do we need a paid “Jarvis-managed DB” tier alongside it (Option D)?

2. **Is service role key required for BYO?** If we drop `setAppAdmin` for BYO, we could require only URL + anon key ( simpler UX, less sensitive data stored ).

3. **What happens to existing managed projects** on dev when we flip to BYO-only? Migrate credentials manually? Pause/delete orphaned Supabase projects?

4. **Mid-chat UX when DB needed but not connected:** block with CTA to settings, or allow code-only generation with mocks/localStorage (we’ve been moving away from mocks)?

5. **Agent output for schema changes:** commit `supabase/setup.sql` only, or also show an in-chat “Copy this SQL to Supabase” panel (Lovable-style approval without API)?

6. **Do we remove managed provisioning code** or gate behind `SUPABASE_MGMT_TOKEN` + feature flag for a future paid tier?

7. **Compliance / enterprise:** any customers who require Jarvis-managed DB in Jarvis’s org vs BYO only?

8. **Naming:** “Connect Supabase” vs “Database settings” — match Lovable wording for familiarity?

---

## Recommendation

**Ship Option A (BYO, no migrations) as the default for dev/UAT and near-term production**, with managed provisioning disabled until we have either:

- Supabase Pro on a dedicated platform org (Option C) for a **paid “hosted database”** tier, or  
- Per-user PAT / OAuth (Option B) if we need migrations on user-owned projects.

**Rationale:** Unblocks development immediately (2-project limit), matches how Lovable’s BYO path works at the infrastructure level, and is the smallest correct slice. The main product tradeoff — **Jarvis no longer auto-creates tables from chat** — should be explicit in UX and marketing.

**Not recommended:** Option E (secrets-only) — incomplete integration, confusing UX.

---

## Success criteria (if approved)

- [ ] New project can deploy a Supabase-backed app when owner has connected BYO credentials
- [ ] No Management API provision attempts on dev without platform org token
- [ ] Workspace chat no longer loops “Setting up your database…” when DB is already connected
- [ ] Revision deploy does not call `applySchema` / `applyMigrations` for BYO projects
- [ ] Documentation: “How to connect Supabase” + optional setup SQL template for profiles/admin

---

## References

- Lovable Supabase integration: https://docs.lovable.dev/integrations/supabase  
- Lovable Cloud (managed Supabase): https://docs.lovable.dev/integrations/cloud  
- Supabase customer story (Management API provisioning): https://supabase.com/customers/lovable  
- Jarvis code: `supabase-provisioning.service.ts`, `supabase.service.ts` (`applyMigrations`), `revisions.service.ts` (`applySupabaseSchemaForRevision`), `supabase-readiness.ts`  
- Incident: dev EC2 PM2 — provision failed, 2 active free projects on platform account
