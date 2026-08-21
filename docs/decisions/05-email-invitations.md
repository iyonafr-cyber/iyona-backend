# Decision 05 — Real email invitations vs immediate membership

## Problem

Today the "Invite member" form on the project Settings → Members panel
(`ProjectSettingsUsers.tsx`) calls
`POST /projects/:id/members/invite` which:

- Looks up the target user by email.
- If found, **adds them to the project immediately** (no notification,
  no consent).
- If not found, returns 404 — telling the inviter "this user doesn't
  exist on Jarvis yet".

Two problems:
1. **Surprise enrollment**: an existing Jarvis user wakes up to a new
   project in their list with no email or in-product banner explaining
   how it got there. We've already had two support tickets thinking
   this was an account compromise.
2. **Dead-end for new users**: if the invitee doesn't have a Jarvis
   account yet, the inviter has to copy the link, ask them to sign up,
   and re-send. The invite isn't actually an invite.

The UI copy says "Invitation sent" — the API does not send anything.

## Options

### A. Token-based email invitations (recommended)

- Inviter enters email + role.
- Backend creates `ProjectInvitation` row:
  `{ projectId, email, role, tokenHash, invitedBy, expiresAt }`.
- Email goes out: "Alex invited you to <Project Name> on Jarvis. Accept
  invitation". Link → `/invite/<token>`.
- Recipient flow:
  - Logged in with matching email → one-click accept → membership
    created.
  - Logged in with different email → "This invitation was sent to
    bob@example.com. Sign in as Bob, or ask Alex to invite this email
    instead."
  - Not logged in → sign-up flow with the email pre-filled and the
    token preserved; on first login membership is created
    automatically.
- Tokens expire in 7 days. Inviter can resend or revoke from the
  Members panel.
- Invitee gets the same audit-log treatment as today (`member.added`
  webhook fires on accept, not invite).

Effort: ~4 dev-days (entity, token mint+hash, email template, accept
endpoint, post-signup resume, Members panel UX, revoke endpoint).

### B. In-app notifications, no email

Same flow but instead of email we drop a notification into a future
in-app inbox.

Pros: no SMTP dependency.
Cons: requires the in-app notification system (not built); doesn't
help non-members; we still need email for the new-user case.

### C. Just fix the copy

Rename the button to "Add member" and ship a banner explaining that
they were added by `<inviter>`. Cheap, accurate, no consent gate.

Pros: 1 hour.
Cons: doesn't unblock the new-user case at all; doesn't address the
consent concern enterprise customers will raise.

### D. Defer

Keep current behaviour, document the surprise-enrollment risk, plan
the email flow as a Phase-3 sprint deliverable.

## Recommendation

**Option A**. The half-built consent surface is the single biggest
trust risk we have today; enterprise pilots will flag it on first
review. The 4-day cost is unambiguously worth it.

We can ship **option C in the meantime** as a one-line copy fix on
the Members panel (rename "Invitation sent" to "Member added" and
add a callout "They'll see this project in their list immediately —
real email invitations coming soon").

## Implementation outline (option A)

1. Schema: `ProjectInvitation` collection
   - `projectId`, `email` (lowercased + indexed), `role`,
     `tokenHash`, `invitedBy`, `invitedAt`, `expiresAt`,
     `acceptedAt?`, `acceptedBy?`, `revokedAt?`.
   - Unique compound index `{ projectId, email, status: 'pending' }`
     so the same email can't have two open invites for the same
     project.
2. Endpoints
   - `POST /projects/:id/members/invite` — re-shape: returns
     `{ invitationId, expiresAt }` instead of creating the membership.
   - `GET /invitations/:token` — public, returns project name +
     inviter name + email (no PII beyond that).
   - `POST /invitations/:token/accept` — auth required (email match
     enforced).
   - `POST /projects/:id/invitations/:invitationId/revoke` — owner /
     admin only.
   - `POST /projects/:id/invitations/:invitationId/resend` — same.
3. Auth resume
   - Reuse the post-login resume hook from PR-1.7 to replay an
     invitation token after sign-up/sign-in.
4. Email
   - Use the existing transactional email plumbing
     (verification + magic-link templates) — no new provider.
   - Subject: "<Inviter> invited you to <Project> on Jarvis".
5. Frontend
   - Members panel shows pending invites separately from members.
   - "Resend" + "Revoke" actions.
   - New `/invite/:token` route: accept screen + sign-up redirect.

## Open questions

- Should the inviter see the invitee's email in the audit log? Yes —
  it's a project they own.
- Rate limit: how many invites per inviter per minute? Recommended:
  reuse the existing `auth` throttle bucket (20 / minute) — invitations
  are cheap but spam-able if we don't gate them.
- Public sign-up still gated by email verification? Yes — invite
  acceptance does not bypass the standard verification flow.
- Domain-allowlisted orgs (Tier-3 plans, decision 03/04) — the org
  may pre-approve a domain so any `@example.com` invitation
  auto-accepts on sign-in. Out of scope for Phase 3, document as a
  follow-up.
