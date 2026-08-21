# Decision 04 — Project quotas

## Problem

PR-2.A added a per-user project quota with a sane default (50 via
`PROJECTS_PER_USER_QUOTA`), but the policy is still single-axis:

- No per-plan limit.
- No per-org limit.
- No idea whether soft-deleted projects count against the cap.
- No surface to ask for an increase short of a support email.

Symptoms in the wild:
- Two waitlist users hit the 50-project cap inside their first week of
  exploration.
- Internal QA accounts get throttled.
- We can't credibly sell a "Team — unlimited projects" plan because
  the cap is a single env var.

## Options

### A. Per-plan, per-user quotas (recommended)

Quota matrix in `plans.ts`:

| Plan      | Projects per user | Soft-deleted count? | Org-wide cap |
| --------- | ----------------- | ------------------- | ------------ |
| Free      | 5 active          | no                  | n/a          |
| Hobby     | 25 active         | no                  | n/a          |
| Team      | 100 active per seat | no                | 500 active per org |
| Enterprise| custom            | configurable        | custom       |

- "Active" = not soft-deleted.
- Override per-account via admin tool (audit-logged).
- 402 / 403 response with `{ kind: 'quota_exceeded', plan, current, limit }`
  so the SPA can render an upgrade prompt instead of a generic error.

Effort: ~3 dev-days (plans.ts wiring, admin override UI, count
recompute job, UX prompts).

### B. Per-org quota only, ignore per-user

Treat the org as the unit of accounting; users inside an org pull from
the same pool. Personal accounts are an "org-of-one" with the same
limits.

Effort: blocked on org refactor.

### C. Stay with the env-var single cap

Effort: zero. Pros: nothing new to build. Cons: can't tell
free-tier apart from team-tier for quota purposes.

## Recommendation

**Option A** as the launch shape, and let it migrate to **option B**
once org ownership lands. The plan-aware quota table replaces the
env-var default; the env var stays as an emergency override knob.

## Implementation outline (option A)

1. Backend
   - Add `quotas.projectsPerUser` to each plan in
     `subscriptions/plans.ts`.
   - In `ProjectsService.createProject`, look up the caller's plan
     (already available via `subscription.planId`) and check the
     plan's quota first; fall back to the env var only when no plan is
     attached.
   - Surface remaining quota on the existing `GET /credits/balance`
     response (or a new `GET /quotas/me`) so the SPA can render
     "X of Y projects used".
2. Soft-delete interaction (decision 02)
   - Soft-deleted projects do **not** count. Restore is allowed even
     when at the cap (the user explicitly chose to free a slot).
3. Admin
   - `PATCH /admin/users/:id/quotas` (audit-logged) for one-off bumps
     so support can unblock people without a deploy.
4. UX
   - When at quota, the project create call returns a `quota_exceeded`
     payload; the SPA renders a modal with "Upgrade plan" + "Free up
     a slot" actions. (`Free up a slot` deep-links to project list.)
5. Background reconciliation
   - Cron weekly recomputes per-user counts to catch drift from
     restores/transfers/admin overrides.

## Open questions

- Hard-cap or grace period? Recommended: hard-cap on creation, no
  retroactive removal. Removing a user's existing project to fit a
  lowered cap is a UX trap.
- What about anonymous (pre-login) project creation from the public
  landing page? Recommended: count anonymous projects against the
  account they get attached to on first login (we already have the
  resume flow from PR-1.7).
- Templates — does forking a template count? Recommended: yes, exactly
  like creating a new project.
