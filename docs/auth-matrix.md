# Auth matrix — projects module

This is the canonical reference for which **role** is required to call each
project endpoint. Land it as part of every PR that adds or moves a route.

## Roles

| Role     | Source                                  | Notes                           |
| -------- | --------------------------------------- | ------------------------------- |
| `owner`  | `UserProject.userId === currentUserId`  | Full access incl. settings.     |
| `admin`  | `ProjectMember.role === 'admin'`        | Chat, patch, edit, error mgmt.  |
| `user`   | `ProjectMember.role === 'user'`         | Read-only collaborator.         |
| `public` | unauthenticated                         | `/public/*` only.               |

The `requireEditor` name is **deprecated** — use `requireOwnerOrAdmin`. It
implied a "viewer" role existed and editors were a subset; neither is true.

## Guard helpers

| Helper                    | Behaviour                                            |
| ------------------------- | ---------------------------------------------------- |
| `requireViewer`           | Allow owner / admin / user.                          |
| `requireOwnerOrAdmin`     | Allow owner / admin.                                 |
| `requireManager`          | Alias of `requireOwnerOrAdmin`. For member mgmt.     |
| `requireOwner`            | Owner only. Use for delete, transfer, payment cfg.   |

## Project endpoints

### Project lifecycle (`projects.controller.ts`)

| Endpoint                                        | Required role        |
| ----------------------------------------------- | -------------------- |
| `POST   /projects`                              | authenticated        |
| `GET    /projects`                              | authenticated (own)  |
| `GET    /projects/shared-with-me`               | authenticated        |
| `GET    /projects/:id`                          | viewer               |
| `PUT    /projects/:id`                          | owner                |
| `DELETE /projects/:id`                          | owner                |
| `POST   /projects/:id/transfer`                 | owner *(planned)*    |

### Settings

| Endpoint                                        | Required role        |
| ----------------------------------------------- | -------------------- |
| `GET    /projects/:id/payment-config`           | owner                |
| `PUT    /projects/:id/payment-config`           | owner                |
| `PUT    /projects/:id/secrets`                  | owner                |
| `PUT    /projects/:id/seo`                      | owner                |
| `PUT    /projects/:id/analytics`                | owner                |
| `GET    /projects/:id/custom-domain`            | owner-or-admin       |
| `POST   /projects/:id/custom-domain`            | owner-or-admin       |
| `DELETE /projects/:id/custom-domain`            | owner-or-admin       |

### Members

| Endpoint                                         | Required role        |
| ------------------------------------------------ | -------------------- |
| `GET    /projects/:id/members`                   | manager              |
| `POST   /projects/:id/members/invite`            | manager              |
| `DELETE /projects/:id/members/:memberId`         | manager              |

### Chat (`chats.controller.ts`)

| Endpoint                                        | Required role        |
| ----------------------------------------------- | -------------------- |
| `GET    /projects/:projectId/chats`             | viewer               |
| `POST   /projects/:projectId/chats`            | owner-or-admin       |
| `GET    /projects/:projectId/chats/:id`         | viewer               |
| `PUT    /projects/:projectId/chats/:id`         | owner-or-admin       |
| `DELETE /projects/:projectId/chats/:id`         | owner-or-admin       |

### Patch / snapshot / build

| Endpoint                                        | Required role        |
| ----------------------------------------------- | -------------------- |
| `POST   /projects/:id/patch`                    | owner-or-admin       |
| `POST   /projects/:id/update`                   | owner-or-admin       |
| `POST   /projects/:id/extract-schema`           | owner-or-admin       |
| `GET    /projects/:id/components`               | viewer               |
| `GET    /projects/:id/components/:cid/versions` | viewer               |
| `POST   /projects/:id/components/:cid/rollback` | owner-or-admin       |
| `GET    /projects/:id/snapshots`                | viewer               |
| `POST   /projects/:id/snapshots/:v/rollback`    | owner-or-admin       |
| `GET    /projects/:id/snapshots/:v/diff`        | viewer               |
| `POST   /projects/:id/snapshots/:v/revert`      | owner-or-admin       |
| `GET    /projects/:id/build-status`             | viewer               |
| `POST   /projects/:id/build-check`              | owner-or-admin       |

### Runtime errors

| Endpoint                                        | Required role        |
| ----------------------------------------------- | -------------------- |
| `POST   /projects/:id/errors`                   | viewer               |
| `GET    /projects/:id/errors`                   | viewer               |
| `PUT    /projects/:id/errors/:errorId`          | owner-or-admin       |

### Sharing / public

| Endpoint                                        | Required role        |
| ----------------------------------------------- | -------------------- |
| `PUT    /projects/:id/public`                   | owner                |
| `POST   /projects/:id/remix`                    | authenticated        |
| `GET    /public/projects/:slug`                 | public               |
| `GET    /public/templates`                      | public               |
| `GET    /public/templates/categories`           | public               |

### AI codegen (`ai.controller.ts`)

Optional `projectId` in the JSON body. When present, **`AiController.assertProjectAccess`**
calls **`ProjectAccessService.requireOwnerOrAdmin`** before any provider work (including
before SSE headers on `/ai/generate-code/stream`). Omitted `projectId` is allowed (pre-project
questionnaire / first build before a project row exists).

| Endpoint                              | Required role (when `projectId` set) |
| ------------------------------------- | ------------------------------------ |
| `POST   /ai/validate`                 | authenticated only (no project gate) |
| `POST   /ai/questionnaire`            | authenticated only                   |
| `POST   /ai/execution-plan`           | authenticated only                   |
| `POST   /ai/generate-code`            | owner-or-admin                       |
| `POST   /ai/generate-code/stream`     | owner-or-admin                       |

## Frontend gating

Backend enforcement is the source of truth. The SPA's job is to **hide
affordances** for actions the caller can't take, so they don't get a
puzzling 403 when they hit Save:

- `OwnerOnlyGuard` (in `src/components/access/OwnerOnlyGuard.tsx`) wraps
  full pages or sections. Used on:
  - `ProjectSettingsPayment` (whole page).
  - `ProjectSettingsOverview` publish/danger sections (inline check).
- `ProjectSettingsUsers` checks `accessRole` directly because it has
  manager-level UI nuances.

## Adding a new endpoint

1. Pick the role from the table above (or extend the table).
2. Call the matching guard at the **service layer**, not just the
   controller. Multiple controllers may call the same service.
3. If you add a new owner-only mutation, wrap the corresponding SPA
   form in `OwnerOnlyGuard` and update this matrix.
