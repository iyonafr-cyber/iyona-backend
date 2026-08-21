# Jarvis backend — fast context

Canonical orientation for **`jarvis-backend`** (NestJS API). Sibling apps: **`jarvis-front`** (user SPA), **`jarvis-admin`** (operator SPA). For full product rules and constraints, see [`.cursor/rules/about-jarvis.mdc`](./rules/about-jarvis.mdc). For graph navigation and CLI queries, see [`.cursor/skills/graphify/SKILL.md`](./skills/graphify/SKILL.md) and `graphify-out/GRAPH_REPORT.md`.

---

## Overview

Jarvis is a **Lovable / Bolt.new–style AI app builder**: users describe an app in natural language; the backend generates and iterates on a **full self-contained React (Vite) repository** per revision (no deploy-time merge with a pinned scaffold tarball). Product surfaces include Monaco editing, sandboxed live preview, **patch-based** edits, **GitHub** export, **Vercel** deploy, credits/billing, and **slash agents** (`/designer`, `/refactor`, `/debugger`, `/reviewer`, `/seo`, `/copywriter`) defined as markdown under `src/agents/*.md`.

| Repo | Role |
|------|------|
| `jarvis-backend` | Auth, projects, AI, patch-engine, revisions/deploy, Stripe, credits, models, orgs, webhooks, admin APIs |
| `jarvis-front` | Workspace (chat + Monaco + preview), settings, billing, org API keys/webhooks/SSO |
| `jarvis-admin` | Dashboard, users, projects, credits, manual subs, models, settings, audit |

**API shape:** global prefix `api`, URI version **v1** → `GET/POST … /api/v1/...` (`main.ts`). **S3** stores full revision trees for legacy paths; **GitHub** is the canonical tree for preview/deploy when a revision has a pinned SHA.

---

## Architecture

### Runtime and platform

| Area | Choice |
|------|--------|
| Framework | **NestJS 11**, TypeScript, Express 5 |
| Data | **MongoDB** + Mongoose (`MONGO_URL`), `maxPoolSize: 10`, 5s server selection, 45s socket |
| HTTP | Body limit **10mb**; Stripe webhook uses **raw** body before JSON parser |
| Validation | `class-validator` + `class-transformer` |
| Auth | **passport-jwt** (access + refresh), Google + GitHub OAuth, **WorkOS** SSO |
| AI providers | Anthropic, OpenAI, Google Gemini — routing/pricing via **ModelsModule** + **CreditsModule**; catalog **default ("Auto") = `gemini-3-1-high`** (Google). Platform provider keys via **AiProviderKeysModule** (`AiProviderRouterService` + `AiProviderHealthService`) |
| Integrations | **Stripe**, **AWS S3**, **Vercel**, **GitHub** (Octokit), optional **Supabase** per project |
| Secrets at rest | **EncryptionModule** (`crypto-js`) — never plaintext project secrets |
| Rate limits | **@nestjs/throttler** global guard; buckets in `app.module.ts`: `short` (30/s), `medium` (300/min), `auth` (20/min), `ai` (30/min) — opt in with `@Throttle({ name: { limit, ttl } })` |
| Jobs | **@nestjs/schedule** (e.g. credit monthly reset safety net) |
| Ops | **nestjs-pino** + `x-request-id`; aggressive redact list; **Sentry** when configured |
| Serverless | **serverless-http** for Lambda-style hosting |

### Cross-cutting HTTP layer

- **Interceptors:** `TransformInterceptor`, `MongoIdNormalizerInterceptor`
- **Filters:** `GlobalExceptionFilter`
- **Bootstrap:** `bootstrap()` in `src/main.ts`
- **Errors:** `logAndThrowError()` — high fan-out helper (graph god node)

### Data model (high level)

- **UserProject** — central aggregate: files, stage, questionnaire, members, deploy metadata, config (SEO, Supabase, custom domain, payment hints).
- **Revision** — file map + optional GitHub SHA; deploy input is tree at SHA (legacy: S3 download).
- **Deployment** — Vercel row per attempt: status (`BUILDING`, `REPAIRING`, `READY`, `FAILED`, …), URLs, `metadata.clientPollingDeploymentId`, `metadata.activeVercelDeploymentId` (repair redeploy), `metadata.repairAttempt` / `repairHistory`.
- **Patch / components / snapshots** — `PatchModule` (controller-less) → `PatchService`: component schema extraction, snapshots, rollback/revert, component versions. File blocks parsed via `common/file-block-parser.ts` (`parseFileBlocks` / `fileBlocksToRecord` / `recordToFileBlocks`). *(The old anchor/codemod patch-engine — `PatchEngineService`, `scanAnchors`, `preApplyValidate`, `SchemaGraphService` — was removed in the patch-engine consolidation.)*

**Named collections (verified `collection:` names):** `ai_models`, `ai_provider_keys`, `admin_audit_logs`, `admin_settings`, `api_keys`, `credit_ledger`, `usage_logs`, `organizations`, `org_members`, `project_errors`, `webhooks`, `webhook_deliveries` (plus Mongoose-default collections, e.g. `deployments`).

### Module registration

Full import order: `src/app.module.ts`. Supporting modules (e.g. `EncryptionModule`, `EmailModule`, `SupabaseModule`) are wired through feature modules, not always top-level.

### Generated-app quality bar

Enforced in prompts + validation: generated apps pin **React 18.3 + Vite 6 + TypeScript ~5.7.3 + Tailwind v4 + react-router v7** (host SPAs are React 19 — don't conflate; mismatched pins break Vercel builds, see `repo-context.service.ts`); components ~**50–150** lines; responsive + a11y; **mock data only**. A locked shadcn-style **UI kit** (`UiKitModule`, `src/ui-kit/files/**`) is merged into every generated repo with palette theming (`palette-generator.ts`) and injected on deploy. Backend: **`BUILDER_REPAIR_CONTRACT`** (`src/common/builder-repair-contract.ts`), **content-completeness** stub gate (`src/common/content-completeness.ts`), deploy gates in **`VercelService`** / **`RevisionsService`** (Vercel build + Cursor repair loop).

**Multi-pass codegen:** big generations fan out per-screen at a **64k** output-token ceiling per pass; the frontend's `runMultiPassGeneration` (≥3 screens) runs scaffold → all `screen.components` → per-page → programmatic missing-component pass (`findMissingImportPaths`) → wire-up, then **`validateGeneratedCode`** in `parser.ts` (dangling `@/` imports block upload). Thin/stub pages are repaired by the **Cursor cleanup** round in `runDeployPipeline` (completeness hint from `evaluateCompleteness`), not extra codegen API calls.

---

## Key modules / hubs

Graph snapshot (commit `4880e1e2`): **2431 nodes**, **4813 edges**, **162 communities** (98% EXTRACTED). Top connectivity (god nodes):

| Rank | Symbol | Edges | Role |
|------|--------|-------|------|
| 1 | `ProjectsService` | 80 | Project lifecycle, workflow, questionnaire, file access |
| 2 | `logAndThrowError()` | 58 | Consistent HTTP error mapping |
| 3 | `ProjectsController` | 49 | Project + workflow HTTP surface |
| 4 | ~~`BuildCheckService`~~ | 40 | **Stale** — removed in patch-engine / build-check consolidation |
| 5 | `CreditsService` | 35 | Balance, reservations, debits |
| 6 | `PatchService` | 32 | AI file blocks, patch prompts, repair contract injection |
| 7 | `RevisionsService` | 32 | Revisions, **`runDeployPipeline`**, preview deploy + repair loop |
| 8 | `OrganizationsService` | 31 | Orgs, members, billing hooks |
| 9 | ~~`scanAnchors()`~~ | 28 | **Stale** — removed in patch-engine consolidation; snapshot predates it |
| 10 | `AuthGuard` | 26 | JWT protection |

> ⚠️ **The on-disk graph snapshot is stale relative to HEAD.** It still contains the old patch-engine nodes (`scanAnchors`, `PatchEngineService`, `parseAiFileBlocks`) and the removed `BuildCheckService` — none exist in code anymore (both removed in the patch-engine / build-check consolidation). It also predates UI-kit/multipass/repair-stubs. Re-run `graphify update .` before trusting node-level details.

**Community hubs** (navigation): `VercelService`, `ProjectsController`, `PatchService`, `LlmService`, `CreditsService`, `cursor.service.ts`, `RepoService`, `RevisionsService`, `AiService`, `RepoContextService`, `AuthService`.

| Module | Responsibility |
|--------|----------------|
| `AuthModule` | Login, signup, refresh, OAuth, JWT strategies |
| `UserModule` | Profile, account |
| `ProjectsModule` | Projects, chats, members, public slug, SEO, custom domain, payment config, **questionnaire** |
| `ProjectAccessModule` | **`ProjectAccessService`** — owner/admin/viewer role checks; imported by `AiModule` (and re-exported via `ProjectsModule`) without pulling the full projects graph |
| `RevisionsModule` | History; **Git-canonical** deploy via `RepoService.readTreeAtSha`; **`deployPreview`** → **`runDeployPipeline`** |
| `PatchModule` | **Controller-less** — `PatchService`: component schema extract, snapshots, rollback/revert, component versions (HTTP via `ProjectsController` → `ProjectsService`) |
| `AiModule` | Generation, streaming, questionnaire, execution plan, multi-pass codegen (frontend-orchestrated) |
| `AiProviderKeysModule` | Platform provider API keys (encrypted), **`AiProviderRouterService`**, **`AiProviderHealthService`** key-probe |
| `UiKitModule` | Locked shadcn-style UI kit (`src/ui-kit/files/**`) + palette theming, merged into generated repos |
| `AgentsModule` | Slash agents (`src/agents/*.md`) |
| `RepoContextModule` | **`RepoContextService`** — AI preambles (`initial` vs `mutate`), file index, design-system hints |
| `GitHubModule` | OAuth, repos, push export; **`RepoService`** for tree/merge |
| `VercelModule` | Deploy, webhooks, preview URL helpers |
| `S3Module` | Assets / legacy revision blobs |
| `StripeModule` + `CreditsModule` | Checkout, portal, ledger, webhooks |
| `ModelsModule` | Catalog, pricing; **`AdminModelsController`** at `/api/v1/admin/models` |
| `OrganizationsModule` | Orgs, **WorkOS** SSO, org billing |
| `ApiKeysModule` | Workspace API keys + scoped public API |
| `WebhooksModule` | Outbound webhooks + deliveries |
| `MigrationsModule` | DB migration runner |
| `Admin*Module` | users, projects, credits, dashboard, settings, manual-subscriptions, audit |

**Cursor / repair (product):** `CursorModule` / `CursorService` — `runRound` with Vercel log tail inside **`RevisionsService.runDeployPipeline`** (not `ProjectsService`). **Harness only:** `scripts/simple-cursor-repo-flow.ts` (`npm run cursor:simple-repo-flow`) — disposable GitHub + Cursor agent flow; not part of `AppModule`.

---

## Cross-cutting flows

### Auth

1. **Register / login** → JWT access + refresh (`AuthModule`, `AuthController`).
2. **OAuth** — Google, GitHub callbacks; **WorkOS** for enterprise SSO (`OrganizationsModule` / `SsoController`).
3. **Guards** — `AuthGuard` + `RolesGuard` on admin routes; project routes use owner/member checks via **`ProjectAccessService`** / `assertProjectOwner` patterns. **AI codegen** (`POST /ai/generate-code`, `/ai/generate-code/stream`): when the body includes `projectId`, **`AiController`** calls **`requireOwnerOrAdmin`** before any LLM work (403/404 before SSE headers on stream).
4. **Public API** — `ApiKeysModule` with scope requirements on selected routes.

**Rules:** verify webhook signatures before trust; never log tokens — extend Pino `redact.paths`; admin mutations → **AuditModule**.

### AI and credits

1. Client calls **`AiModule`** (throttle: **`ai`** bucket, 30/min).
2. **`ModelRouterService`** / **`LlmService`** / **`AiProviderRouterService`** pick provider + model from catalog and keys.
3. **`CreditsService`** reserves/debits per action; pricing from **`ModelsModule`** / **`PricingService`**.
4. Streaming and questionnaire paths in **`AiService`**; locale hints via **`resolveConversationLocale()`** (see Graphify note below).
5. Prompt context from **`RepoContextService`** + **`PatchService`** (includes **`BUILDER_REPAIR_CONTRACT`** + injected UI-kit hints). **`AiService.resolveProjectGenContext`** picks preamble mode: **`initial`** (full-repo mandate + pinned stack) when the project has no revision yet; **`mutate`** (file tree from **`RevisionsService.getCurrentFilesForGeneration`**) when a revision exists. Applies to every multi-pass sub-call until the first revision is saved.
6. **Multi-pass generation:** frontend fan-out per screen; stub/thin content handled at deploy by Cursor cleanup (`evaluateCompleteness` → `completenessHint` on the agent prompt).

**Rules:** always debit credits for LLM calls; monthly cron reset is safety net only; return i18n **keys** for UI-facing errors where applicable.

### Projects, patch, revisions

**Projects**

- CRUD, workflow stages, **`POST …/workflow/save-questionnaire`** → persists `questionnaire`, stage **`questionnaire-ready`** (`SaveQuestionnaireDto`, owner-gated).
- Chats, members, errors, analytics/SEO/Supabase config on **UserProject**.

**Patch** (consolidated — controller-less `PatchModule`, served via `ProjectsController` → `ProjectsService`)

- AI returns file blocks → parsed by **`common/file-block-parser.ts`** (`parseFileBlocks` / `fileBlocksToRecord` / `recordToFileBlocks`).
- **`PatchService`** owns: `extractComponentSchema`, `createSnapshot`, `rollbackComponent` / `rollbackProject`, `diffSnapshotAgainstCurrent`, `revertFilesToSnapshot`, component versions, `seedComponentsFromTemplate`.
- *(The previous anchor/codemod engine — `PatchEngineService`, `PatchApplicationService`, `preApplyValidate`, `scanAnchors`, `backfillAnchors`, `SchemaGraphService` — no longer exists.)*

**Revisions**

- Upload/create revision → **`assertRevisionWithinLimits`**, **`assertSafeRelativePath`**.
- **Preview deploy:** `RevisionsService.deployPreview` → **`runDeployPipeline`**:
  1. Read tree: **GitHub SHA** (`RepoService.readTreeAtSha`) or legacy **S3**.
  2. Optional **Supabase** migrations on file map.
  3. **`VercelService.createDeployment`** (strip `.env*`, bridge/SEO helpers).
  4. **`waitForVercelOutcomeHybrid`** (~8 min cap per attempt).
  5. On **ERROR:** classify failure; skip infra patterns; else **`CursorService.runRound`** (`kind: 'repair'`), merge to `main`, new SHA, redeploy until success or **`CURSOR_REPAIR_MAX_ATTEMPTS`**.
  6. On **READY:** **`finalizeDeploymentInBackground`** (alias, persist READY, revision **DEPLOYED**).
- SPA polls **`metadata.clientPollingDeploymentId`**; repair may set **`metadata.activeVercelDeploymentId`** — **`getDeploymentProgress`** resolves either.

### Deploy, Vercel, GitHub

| Step | Owner |
|------|--------|
| Export / push | `GitHubModule`, `RepoService` |
| Tree at commit | `RepoService.readTreeAtSha` |
| Vercel create + wait | `VercelService`, `RevisionsService` |
| Preview URL for API | `finalizePreviewUrlForApi()` → **`withVercelProtectionBypass()`** |
| Vercel webhooks | `VercelWebhookController` / `VercelWebhookService` |
| Static gate wiring | `revisions-deploy-static-gate` tests |

**GitHub env:** prefer **`GITHUB_PAT`** or **`JARVIS_GITHUB_TOKEN`**; optional **`JARVIS_GITHUB_ORG`** for org repos.

**Do not** bypass `runDeployPipeline` with ad-hoc deploys that skip deployment/revision consistency.

### Billing

- **Stripe:** checkout, portal, **`StripeWebhookController`** (raw body route registered first in `main.ts`).
- **Plans:** `plans.ts` — plan definitions, top-up packs; org plans in org billing module.
- **Credits:** ledger (`credit_ledger`), subscriptions, top-ups; admin adjust via **`AdminCreditsModule`**.
- **Manual subscriptions:** `AdminManualSubscriptionsModule` for operator overrides (audited).

---

## Graphify snapshot (commit `4880e1e2`)

- **Graph:** 2431 nodes · 4813 edges · 162 communities (106 shown, 56 thin omitted) · 98% EXTRACTED · 2% INFERRED
- **Stale check:** `git rev-parse HEAD` vs report commit (HEAD is now ahead — UI-kit/multipass/repair-stubs landed after the snapshot); `graphify update .` after material changes
- **Do not** load `graphify-out/graph.json` into chat — use `graphify query`, `graphify path`, `graphify explain`

**Surprising links (verified in graph):**

1. **`resolveConversationLocale()` → `franc`** — language detection in `conversation-locale.ts` ties AI locale routing to the `franc` dependency (INFERRED edge to `package.json`).
2. **`evaluateCompleteness()` → Cursor cleanup** — deploy pipeline scans the GitHub tree and passes flagged stub paths to `CursorService` via `completenessHint` (`src/common/content-completeness.ts`).
3. **`finalizePreviewUrlForApi()` → `withVercelProtectionBypass()`** — API preview URLs append bypass query params for protected Vercel previews (`revisions-preview-url.resolver.ts` → `vercel-deployment-url.util.ts`).
4. **UI-kit `Card()` / `CardHeader()` → `cn()`** — injected kit components (`src/ui-kit/files/components/ui/*`) all route styling through the kit's own `cn()` helper (`src/ui-kit/files/lib/cn.ts`).

**Suggested graph questions:** impact of changing `ProjectsService`; path from `AuthGuard` to deploy pipeline; whether `VercelService` should split (low cohesion per report).

---

## Sibling frontends (brief)

**jarvis-front:** … Workspace codegen: `multipass.ts`, `generator.ts`, `parser.ts`; stub content fixed by Cursor on deploy (not a separate codegen endpoint).

**jarvis-admin:** React 19, Vite 7, TypeScript 6, Node 24, same stack + **recharts**; services under `src/services/features/admin/*`; admin role required; confirm destructive actions in UI. Consumes the vendored **`@jarvis/api-client`** (`packages/jarvis-api-client`, mirrored from jarvis-front). Surfaces: dashboard, users (incl. manual subscriptions on `UserDetailPage`), projects (`ProjectDetailPage` — Supabase schema, scaffold metadata), credits, models, **provider-keys** (`/provider-keys`, Health-badge probe), settings, audit. Orientation: [`../jarvis-admin/.cursor/APP_CONTEXT.md`](../jarvis-admin/.cursor/APP_CONTEXT.md).

---

## Coding rules (backend)

- Strict TS; ESLint + Prettier; DTOs at controller boundary.
- Nest DI — Mongoose models only in owning module.
- Throttler: use existing buckets; don't add buckets without reason.
- Webhooks: verify Stripe/GitHub signatures.
- Admin writes: services that **AuditModule** records.
- Questionnaire: only via **`ProjectsService.saveQuestionnaire`**.
- Mongo: lean queries; respect pool limits.

---

## Environment touchpoints (names only)

`MONGO_URL`, Stripe keys, S3/Vercel/GitHub tokens, WorkOS, `SENTRY_DSN`, `ALLOWED_ORIGINS` / `ADMIN_WEB_ORIGIN`, `CURSOR_*` for agents/repair, `GITHUB_PAT` / `JARVIS_GITHUB_TOKEN`, `JARVIS_GITHUB_ORG`. No secrets in this doc or logs.

---

## Pointers

| Resource | Path |
|----------|------|
| Stack, modules, constraints | [`.cursor/rules/about-jarvis.mdc`](./rules/about-jarvis.mdc) |
| Graphify skill (query, update) | [`.cursor/skills/graphify/SKILL.md`](./skills/graphify/SKILL.md) |
| Graph report (hubs, god nodes, gaps) | [`graphify-out/GRAPH_REPORT.md`](../graphify-out/GRAPH_REPORT.md) |
| Agent conventions | [`AGENTS.md`](../AGENTS.md) |

**Version:** June 2026 — exact package versions in each repo's `package.json`. Sibling orientation docs: `jarvis-front/.cursor/APP_CONTEXT.md`, `jarvis-admin/.cursor/APP_CONTEXT.md`. Update this file when adding major backend flows.
