# Product decisions — Phase 3

This folder collects the product calls that came out of the
launch-readiness audit (see `auth-matrix.md` and the PR-2 series for the
engineering counterparts). Each doc has the same shape:

1. **Problem** — what the gap looks like in the product today.
2. **Options** — every credible answer with effort, UX cost, and
   security/abuse implications.
3. **Recommendation** — the option I'd ship and why.
4. **Open questions** — what we still need from the founder/PM before
   coding starts.

These are intentionally not implementation tickets. Once a decision is
locked, each doc gets a follow-up engineering plan that turns it into
PRs.

## Index

| # | Decision                                                        | File                                              | Status   |
| - | --------------------------------------------------------------- | ------------------------------------------------- | -------- |
| 1 | Project ownership transfer                                      | [01-ownership-transfer.md](./01-ownership-transfer.md)         | Drafted |
| 2 | Soft-delete + restore window — UX + retention policy            | [02-soft-delete-restore.md](./02-soft-delete-restore.md)       | Drafted |
| 3 | True viewer role + role hierarchy                               | [03-viewer-role.md](./03-viewer-role.md)                       | Drafted |
| 4 | Project quotas (per user / per plan / per org)                  | [04-project-quotas.md](./04-project-quotas.md)                 | Drafted |
| 5 | Real email invitations vs immediate membership                  | [05-email-invitations.md](./05-email-invitations.md)           | Drafted |
| 6 | Built-app payments architecture (Connect vs Edge vs deferred)   | [06-builtapp-payments.md](./06-builtapp-payments.md)           | Drafted |
| 7 | Supabase BYO (owner-connected) vs managed provisioning           | [07-supabase-byo-no-migrations.md](./07-supabase-byo-no-migrations.md) | **Decided — backend shipped** |
