# Decision 03 — True viewer role + role hierarchy

## Problem

The current `ProjectMemberRole` enum has two values:

```ts
enum ProjectMemberRole {
  ADMIN = 'admin',
  USER  = 'user',
}
```

Plus the implicit `owner` (project creator). PR-1.1 normalised the
backend so:

- `owner` — full access incl. settings, billing, transfer, delete.
- `admin` — chat, patch, edit, error mgmt, can resolve issues.
- `user` — read-only collaborator.

That last one is what we're calling "viewer" in user-facing UI. The
problem:

- The schema name (`USER`) is meaningless — every collaborator is a
  user.
- Sales/marketing copy talks about "viewers" so we can pitch
  read-only invites; the schema doesn't reflect that.
- Some customers want a true **commenter** tier (read + comment on
  patches/chat, no edits). Lovable / Notion / Figma all have this.
- We have nowhere to put a future **billing-admin** role for finance
  teams who need to manage Stripe/credits without seeing project code.

## Options

### A. Rename `USER` → `VIEWER`, defer richer hierarchy

- Migration: `db.projectmembers.updateMany({ role: 'user' }, { $set: { role: 'viewer' } })`.
- Update enum, helper guards, frontend role labels, audit log copy.
- Effort: half a day.
- Pros: cheapest; aligns vocabulary with the rest of the industry;
  unblocks marketing copy.
- Cons: still only three tiers.

### B. Full hierarchy: `owner` > `admin` > `editor` > `commenter` > `viewer`

- New roles need new guards (`requireCommenter`,
  `requireEditor` distinct from `requireOwnerOrAdmin`, etc.).
- UI: per-row role picker on the Members panel.
- Migration: existing `admin` → `admin`, `user` → `viewer`.
- Effort: 1 sprint (lots of guard rewiring).
- Pros: matches enterprise expectations; future-proof.
- Cons: large auth-matrix surface area; every endpoint needs an
  explicit role decision; risk of regressions.

### C. Skip viewer/commenter, add `billing_admin` only

- Keeps the current code/edit hierarchy.
- Adds a billing-only role for Stripe + credits + plan management.
- Effort: 1 dev-day.
- Pros: solves the most-requested enterprise gap.
- Cons: doesn't help the "share read-only" use case.

### D. Defer

We can keep the current shape; collaborators that need read-only just
stay an `admin` who chooses not to make changes.

Pros: zero work.
Cons: trust model is wrong for enterprise; we can't sell "share with
your client to preview".

## Recommendation

Two-step ship:

1. **Now (option A)**: rename `user` → `viewer` in the enum and across
   the UI. Half a day, no behaviour change for existing members.
2. **Within the org refactor (option B)**: add `editor` and
   `commenter` once we have the org-level role inheritance to back
   them. Doing it before that creates a per-project role explosion
   we'll have to undo.

Option C is parked until the built-app payments architecture lands
(decision 06) — we don't know what billing surfaces exist for a
billing-admin to manage yet.

## Implementation outline (option A — now)

1. `ProjectMemberRole.USER` → `ProjectMemberRole.VIEWER`. Keep the
   string value the same on the schema for compatibility, just
   change the enum identifier (or migrate; either works because the
   only callers are server-side).
2. `requireOwnerOrAdmin` stays the same. Add a `requireOwnerAdminOrViewer`
   convenience guard so `GET` endpoints can spell out "any
   collaborator" intent.
3. UI: replace every "User" role label with "Viewer". Update the
   role-picker tooltip ("can read, cannot make changes").
4. Audit log entries that say `role: 'user'` — backfill is optional;
   the schema string is the source of truth so the log is still
   accurate.

## Open questions

- Do we want the role string in the DB to actually change (`'user'`
  → `'viewer'`) or just the enum identifier? Recommended: change the
  string too via a one-shot migration so the API surface is
  self-describing for partner integrations.
- Inviting someone to be an admin is an upgrade; should that require
  the recipient to re-accept? Recommended: yes for `admin`, no for
  `viewer` (matches the email-invitations decision 05).
- Public link visitors are role-less — they're not members. Doc that
  explicitly so we don't accidentally treat them as `viewer` in some
  endpoints.
