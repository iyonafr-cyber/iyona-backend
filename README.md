# jarvis-backend

NestJS 11 API for **Jarvis AI** — a Lovable / Bolt.new-style AI app builder. Owns auth, projects, AI code generation, the patch engine, revisions/deploy, Stripe billing, credits, the model catalog, organizations, webhooks, and the admin APIs. Each generated app is a full self-contained React (Vite) repository owned end-to-end by the AI (no pinned scaffold tarball), with a locked shadcn-style UI kit injected at deploy.

## Stack

NestJS 11 · MongoDB + Mongoose · Express 5 · passport-jwt (+ Google/GitHub OAuth, WorkOS SSO) · Anthropic / OpenAI / Google Gemini (catalog default "Auto" = `gemini-3-1-high`) · Stripe · AWS S3 · Vercel · GitHub (Octokit) · nestjs-pino + Sentry · `serverless-http` for Lambda. API shape: global prefix `api`, URI version `v1` → `/api/v1/...`.

## Quick start

```bash
nvm use            # Node from .nvmrc
npm install
cp .env.example .env   # fill in Mongo, Stripe, S3, Vercel, GitHub, AI provider keys
npm run start:dev  # Nest watch mode
npm run build
npm run lint       # ESLint --fix
npm run format     # Prettier
npm test           # Jest unit
npm run test:e2e   # Jest e2e
```

Useful scripts: `npm run stripe:seed`, `npm run promote:admin`, `npm run cursor:simple-repo-flow` (disposable GitHub + Cursor repair harness, not part of `AppModule`).

## Key flows

- **Multi-pass codegen:** large generations fan out per-screen (≥3 screens on the frontend) in `multipass.ts`; stub/placeholder pages are fixed by the **Cursor cleanup** round during deploy (`runDeployPipeline`), not extra codegen API calls. **Codegen preamble:** `AiService` uses **`initial`** mode until the project has a revision; **`mutate`** + latest revision files when one exists.
- **AI project scope:** optional `projectId` on generate/stream is authorized via **`ProjectAccessModule`** (`requireOwnerOrAdmin`).
- **Deploy pipeline:** `RevisionsService.deployPreview` → `runDeployPipeline` reads the GitHub tree at the pinned SHA (legacy: S3), creates a Vercel deployment, and on failure runs the Cursor repair loop until success or `CURSOR_REPAIR_MAX_ATTEMPTS`.
- **Provider keys:** platform AI provider API keys are encrypted and managed via `AiProviderKeysModule` (`AiProviderRouterService` + `AiProviderHealthService`).

## Orientation

Read [`AGENTS.md`](./AGENTS.md) first, then the detailed context in [`.cursor/APP_CONTEXT.md`](./.cursor/APP_CONTEXT.md) and [`.cursor/rules/about-jarvis.mdc`](./.cursor/rules/about-jarvis.mdc) (modules, constraints, flows). Sibling orientation: [`../jarvis-front/.cursor/APP_CONTEXT.md`](../jarvis-front/.cursor/APP_CONTEXT.md), [`../jarvis-admin/.cursor/APP_CONTEXT.md`](../jarvis-admin/.cursor/APP_CONTEXT.md). For code navigation use the graphify graph: [`graphify-out/GRAPH_REPORT.md`](./graphify-out/GRAPH_REPORT.md) and [`.cursor/skills/graphify/SKILL.md`](./.cursor/skills/graphify/SKILL.md). EC2/deploy notes live in `../AWS/README-EC2.md`.
