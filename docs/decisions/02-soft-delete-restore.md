# Decision 02 — Soft-delete + restore window

## Problem

PR-2.B (concurrency + atomicity) replaced the hard-delete in
`ProjectsService.deleteProject` with a 30-day soft-delete:

- `deleteProject` now stamps `deletedAt = now()` and returns immediately.
- A daily cron (`purgeExpiredSoftDeletes`) runs the existing
  Vercel/Supabase/S3/Mongo cascade for any project past the retention
  window.
- A new `POST /projects/:id/restore` undoes the soft-delete inside the
  window.

That's the engineering shape. The product surface still needs to be
specified:

- **Where does the user see deleted projects?** Today they just
  disappear from the list.
- **Who can restore?** Today: only the owner.
- **What happens to the deployed app during the window?** Today: it
  keeps serving (we haven't unpublished from Vercel until the purge
  cron runs).
- **What does "delete" mean to the user?** Lovable / Vercel call it
  "Move to trash"; Notion calls it "Move to bin". Our copy still says
  "Delete this project — this cannot be undone" which is now a lie.

## Options

### A. Trash bin in the projects list (recommended)

- Sidebar item: "Trash" (or "Recently deleted").
- Lists soft-deleted projects with `deletedAt`, days remaining,
  "Restore" and "Delete forever" actions.
- Project list filters out `deletedAt: { $ne: null }`.
- Public deploy is **paused** at delete time (we ask Vercel to disable
  the alias) but the underlying files stay in S3 + Vercel until purge
  so restore is instant.
- Members can see the trash bin when they're an admin; only the owner
  can restore or hard-delete.
- Copy: "Delete project" → confirm dialog says "We'll keep your
  files for 30 days. You can restore from the Trash any time before
  then."

Effort: ~2 dev-days (list endpoint already supports the filter, needs
a counterpart `GET /projects/trash` and a `POST /projects/:id/purge`
for "Delete forever").

### B. Silent retention, no UI

Keep PR-2.B's behaviour (server-side restore endpoint exists, no UI).
Useful for support recovery but wastes the UX win and confuses users
who think delete = gone.

### C. Configurable retention per plan

Free / Hobby = 7 days, Team = 30, Enterprise = 90.

Layer on top of A; tracked as a follow-up.

## Recommendation

Ship **option A** with a fixed 30-day retention for everyone in the
first cut. Option C is a clean follow-up once Tier-3 plans are real.
Option B is what we have today and is strictly worse than A.

## Implementation outline (post-decision)

1. Backend
   - `GET /projects/trash` — owner + admin members. Returns soft-deleted
     projects with `deletedAt`, `daysRemaining`, ownership info.
   - `POST /projects/:id/purge` — owner only. Skips the retention
     window, runs the cascade now. Audit log + `project.deleted` webhook
     with `reason: 'purged_by_user'`.
   - On soft-delete, also call `vercelService.disableAlias(projectId)`
     so the public preview/custom domain stops serving immediately
     (and unstop on restore). Idempotent — failures don't block the
     soft-delete.
2. Frontend
   - Trash route under projects.
   - Confirm dialog copy + retention countdown banner.
   - Project list shows a "Restored" toast when the user comes back to
     a project they brought back.
3. i18n
   - New keys: `projects.trash.title`, `…empty`, `…daysRemaining`,
     `…restore`, `…purge`, `…confirmPurge`.

## Open questions

- Should custom domains be released back to the global pool on
  soft-delete, or held until purge? Recommended: released immediately
  so the user can repoint elsewhere; restore re-adds the domain and
  may fail if it's been claimed in the meantime (we surface that
  cleanly with the existing stale-domain UX from PR-1.4).
- What about Supabase projects? Recommended: paused at soft-delete
  (`supabase.pauseProject`), resumed on restore, deleted at purge.
  Avoids billing the user for an idle Supabase during the window.
- GDPR "right to be forgotten" — we must always honour an immediate
  hard-delete request. The `purge` endpoint above is the user-facing
  shape; admin support has a parallel admin endpoint already gated by
  audit log.
