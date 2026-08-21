# Decision 01 — Project ownership transfer

## Problem

Today a project's owner is locked in for life:

- `UserProject.userId` is set at create time and never updated.
- `assertProjectOwner` is a `userId === currentUserId` equality check
  in `ProjectAccessService`.
- The "Members" panel can promote a collaborator to `admin` (and PR-1.1
  made admins owner-equivalent for chat/patch flows), but admins still
  can't:
  - Delete the project
  - Change billing / Stripe config
  - Transfer to another user
  - Move the project to a different organization (when org-scoped
    projects ship)

Real-world consequences we've already hit:
- Two waitlist users left their company; the project is stranded on a
  personal email no-one can recover.
- One team built a customer-facing app under a contractor's account and
  can't move it to the customer's org.
- For Tier-3 plans we promise SSO/SCIM-managed seats; ownership lock-in
  breaks the promise the moment a seat is deprovisioned.

## Options

### A. Owner transfer with **two-sided accept**

- Owner clicks "Transfer ownership" → picks a current member.
- We mark the project `pendingTransferTo: <userId>`, freeze further
  ownership/billing changes, and email both parties.
- Recipient accepts → atomic update of `userId`, demote previous owner
  to `admin`, audit-log the swap.
- 7-day expiry → auto-cancel.

Effort: ~3 dev-days (entity field, two endpoints, one cron, email
template, audit-log entry, settings UI panel).

Risk: low. Aligns with Vercel/Linear/Notion patterns.

### B. Owner transfer with **one-sided demote** (no accept)

Same flow, but the recipient is auto-promoted on click. Faster but
opens a hostile-handoff angle (an owner can dump a project with active
Stripe charges onto another user).

Effort: ~1 dev-day. Risk: medium (abuse + accidental).

### C. Org-managed transfer only

Make ownership a property of an organization, not a user. Org admins
can reassign any project. Personal projects implicitly belong to a
"personal org" the user is the only admin of.

Effort: ~2 sprints (org ownership migration is the heavy part — every
auth check, every quota, every billing seat lookup needs the new
shape).

Risk: high coupling to the org refactor; correct long-term answer.

### D. Defer

Accept the support cost; tell teams to share credentials.

Risk: GDPR (a user who deletes their account orphans the project) and
poor enterprise story.

## Recommendation

Ship **option A** (two-sided accept) inside Phase-3 work, time-boxed to
two weeks. Option C is the right destination but blocked on the org
refactor. A keeps the data model untouched (`userId` stays the source
of truth) and unblocks the customer-handoff use case without delaying
the org refactor; when org-ownership lands the transfer endpoint
collapses into "change `organizationId`" with the same accept flow.

## Implementation outline (post-decision)

1. Schema: add `pendingTransferTo`, `pendingTransferRequestedAt`,
   `pendingTransferRequestedBy` to `UserProject`.
2. Endpoints:
   - `POST /projects/:id/transfer` — owner only. Validates the target
     is an `admin` member or has a verified Jarvis account. Creates
     pending state, sends two emails, audit-log entry.
   - `POST /projects/:id/transfer/accept` — recipient only. Atomic
     `userId` swap inside a Mongo transaction, demote previous owner
     to `admin`, clear pending fields, audit-log, fire
     `project.transferred` webhook.
   - `POST /projects/:id/transfer/cancel` — either party.
3. Cron: nightly job auto-cancels transfers older than 7 days.
4. Settings UI: "Danger zone" → "Transfer ownership" panel; both sides
   see banner-level state ("Transfer pending — accept by …").
5. Quota: don't tip the recipient over their per-user project quota
   (PR-2.A) — block accept with a clear error if it would.

## Open questions

- Do we charge transfer events against the credit balance? (Default:
  no.)
- Stripe Connect (decision 06) — when a project has an attached
  built-app Stripe account, do we transfer that too or force the new
  owner to reconnect? Recommended: force reconnect.
- Should super-admin ("Jarvis admin") be able to force-transfer for
  account-recovery support tickets? Recommended: yes, gated behind a
  dedicated audit-logged endpoint and a 2FA reauthentication.
