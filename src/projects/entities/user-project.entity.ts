import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { Document } from 'mongoose';

export enum ProjectStatus {
  DRAFT = 'DRAFT',
  BUILDING = 'BUILDING',
  DEPLOYED = 'DEPLOYED',
  FAILED = 'FAILED',
}

// Workflow state machine enums
export enum ProjectStage {
  CONVERSATION = 'conversation',
  /** AI emitted questions; user has not submitted answers yet (resume target). */
  QUESTIONNAIRE_READY = 'questionnaire-ready',
  QUESTIONNAIRE = 'questionnaire',
  EXECUTION_PLAN = 'execution-plan',
  CODE_GENERATION = 'code-generation',
  DEPLOYMENT = 'deployment',
  DEPLOYED = 'deployed',
  FAILED = 'failed',
}

export enum StageStatus {
  IDLE = 'idle',
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

export enum TaskType {
  EXECUTION_PLAN = 'execution-plan',
  CODE_GENERATION = 'code-generation',
  DEPLOYMENT = 'deployment',
}

/**
 * Shared phase status for the workflow's generation and deployment substages.
 * Previously we had two separate enums (`GenerationStatus`, `DeploymentStatus`)
 * with identical shapes, plus a third `DeploymentStatus` in the revisions
 * module that tracked Vercel's build state and used totally different values
 * (QUEUED/BUILDING/READY/...). The name collision meant a bad import at the
 * wrong callsite would silently produce "impossible" statuses.
 */
export enum WorkflowStatus {
  NOT_STARTED = 'not_started',
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

// Legacy aliases — kept so existing imports keep compiling while we migrate
// the module over. New code should import `WorkflowStatus` directly.
export const GenerationStatus = WorkflowStatus;
export type GenerationStatus = WorkflowStatus;
export const DeploymentStatus = WorkflowStatus;
export type DeploymentStatus = WorkflowStatus;

// Sub-schema for current task
@Schema({ _id: false })
export class CurrentTask {
  @Prop({
    type: String,
    enum: TaskType,
    required: false,
  })
  type?: string;

  @Prop({ type: Date, required: false })
  startedAt?: Date;

  @Prop({ type: Date, required: false })
  lastHeartbeat?: Date;

  @Prop({ type: Number, default: 0 })
  retryCount: number;
}

// Sub-schema for code generation
@Schema({ _id: false })
export class Generation {
  @Prop({
    type: String,
    enum: WorkflowStatus,
    default: WorkflowStatus.NOT_STARTED,
  })
  status: string;

  @Prop({ type: Number, default: 0 })
  revision: number;

  @Prop({ type: [String], default: [] })
  generatedFiles: string[];

  @Prop({ type: Date, required: false })
  completedAt?: Date;
}

// Sub-schema for deployment
@Schema({ _id: false })
export class DeploymentInfo {
  @Prop({
    type: String,
    enum: WorkflowStatus,
    default: WorkflowStatus.NOT_STARTED,
  })
  status: string;

  @Prop({ type: String, required: false })
  deploymentId?: string;

  @Prop({ type: String, required: false })
  previewUrl?: string;

  @Prop({ type: String, default: 'vercel' })
  provider: string;

  @Prop({ type: Date, required: false })
  completedAt?: Date;
}

// Sub-schema for GitHub configuration (user-connected secondary repo)
@Schema({ _id: false })
export class GitHubConfig {
  // owner/repo style handle, e.g. "acme/generated-app-123"
  @Prop({ type: String, required: false })
  repository?: string;

  @Prop({ type: String, required: false, default: 'main' })
  branch?: string;

  // Auto-push to GitHub after every successful code generation.
  // Defaults to FALSE so we don't silently push code without the user
  // explicitly opting in.
  @Prop({ type: Boolean, default: false })
  autoPush: boolean;
}

/**
 * Iyona-owned GitHub repo that is canonical source-of-truth for this project.
 * Created once when the first revision is generated. All deploys read from this
 * repo (pinned SHA). The user-connected repo (githubConfig) remains a secondary
 * mirror for the future "push to my repo" feature.
 */
@Schema({ _id: false })
export class IyonaGithubRepo {
  /** GitHub org login, e.g. "iyona-apps" */
  @Prop({ type: String, required: true })
  owner: string;

  /** Repo name, e.g. "todoapp-bee" */
  @Prop({ type: String, required: true })
  repo: string;

  /** Always "main" for now */
  @Prop({ type: String, required: true, default: 'main' })
  defaultBranch: string;

  /** https://github.com/{owner}/{repo} */
  @Prop({ type: String, required: true })
  htmlUrl: string;

  @Prop({ type: Date, required: true })
  createdAt: Date;
}
export const IyonaGithubRepoSchema =
  SchemaFactory.createForClass(IyonaGithubRepo);

/**
 * Supabase project linked to this generated app (E1 in the platform
 * roadmap). Populated when the user opted into `withDatabase` at
 * project create time and the `SupabaseProvisionerService` finishes
 * spinning up a managed Postgres + Auth + Storage stack via the
 * Supabase Management API.
 *
 * `serviceRoleKeyEnc` is encrypted via `EncryptionService` — the raw
 * service-role key NEVER leaves the backend except as a Vercel build
 * env at deploy time. The `anonKey` is technically a public token
 * (RLS-gated, designed to ship to the browser), but we still store
 * it as `anonKeyEnc` (PR-2.C) so a database leak doesn't hand
 * attackers a ready-to-use credential per project, and so member
 * redaction has a single rule ("strip every `*Enc` field"). The
 * legacy `anonKey` field is still read for backwards compatibility
 * with rows provisioned before encryption-at-rest landed.
 */
export type SupabaseStatus =
  | 'none'
  | 'pending'
  | 'provisioning'
  | 'ready'
  | 'failed';

/**
 * Who owns the Supabase project behind this app (decision 07).
 *
 * - `managed` — Iyona provisioned it in the platform org via the Management
 *   API. Legacy: gated behind `SUPABASE_MANAGED_PROVISIONING`, off by default.
 * - `byo` — the owner created it in their own Supabase account and connected
 *   it from Project settings. Iyona holds credentials but no org-level
 *   authority, so DDL goes over a direct Postgres connection if the owner
 *   supplied one, and is handed to them as SQL if not.
 *
 * Absent on rows written before decision 07 — treat missing as `managed`.
 */
export type SupabaseSource = 'managed' | 'byo';

@Schema({ _id: false })
export class SupabaseConfig {
  /** Supabase Management API project ref (e.g. `abcd1234`). */
  @Prop({ type: String, required: false })
  projectRef?: string;

  /**
   * How this project got its database. Drives which SQL transport migrations
   * use — see `resolveSupabaseMigrationMode` in `supabase-readiness.ts`.
   */
  @Prop({ type: String, enum: ['managed', 'byo'], required: false })
  source?: SupabaseSource;

  /** `https://<ref>.supabase.co`. Cached so callers don't recompute. */
  @Prop({ type: String, required: false })
  url?: string;

  /**
   * Legacy plaintext anon key — present on rows provisioned before
   * PR-2.C added encryption-at-rest. New rows leave this empty and
   * populate `anonKeyEnc` instead. The migration path is lazy:
   * `getDecryptedAnonKey` returns the legacy value when present.
   */
  @Prop({ type: String, required: false })
  anonKey?: string;

  /** Encrypted (AES) anon key — written by new provisioning flows. */
  @Prop({ type: String, required: false })
  anonKeyEnc?: string;

  /** Encrypted (AES) service role key — NEVER returned to the SPA. */
  @Prop({ type: String, required: false })
  serviceRoleKeyEnc?: string;

  /**
   * Encrypted (AES) Postgres connection string for BYO projects — the single
   * credential that lets Iyona run migrations against a database it does not
   * own (decision 07).
   *
   * SERVER-ONLY, and more sensitive than everything above it: the anon key is
   * RLS-gated by design and the service-role key is scoped to one project's
   * API, but this is superuser-adjacent DDL access to the owner's Postgres.
   * It must never reach the SPA, the Cursor agent, or a build env — see the
   * `SUPABASE_DB_URL` entry in `deployable-env-key.ts`, which blocks the
   * matching key from ever being injected into a Vercel deployment.
   *
   * Absent means the owner declined to hand over DDL access; migrations fall
   * back to the copy-paste script in `pendingMigrationSql`.
   */
  @Prop({ type: String, required: false })
  dbUrlEnc?: string;

  /**
   * Which Supabase connection string the owner pasted (`pooler-session`,
   * `direct`, …). Stored purely so the settings panel can warn about the
   * IPv6-only direct string without decrypting the credential.
   */
  @Prop({ type: String, required: false })
  dbUrlKind?: string;

  /** When the owner connected their own Supabase project. */
  @Prop({ type: Date, required: false })
  connectedAt?: Date;

  /**
   * SQL the owner still needs to run by hand, set when a revision produced
   * schema changes but the project has no usable DDL transport. Rendered in
   * the settings panel as a copy-paste block. Cleared once a migration
   * actually applies.
   */
  @Prop({ type: String, required: false })
  pendingMigrationSql?: string;

  /** When `pendingMigrationSql` was generated. */
  @Prop({ type: Date, required: false })
  pendingMigrationAt?: Date;

  /** Supabase region slug, e.g. `us-east-1`. */
  @Prop({ type: String, required: false })
  region?: string;

  /** Lifecycle status used by the SPA to render provisioning UI. */
  @Prop({
    type: String,
    enum: ['none', 'pending', 'provisioning', 'ready', 'failed'],
    default: 'none',
  })
  status: SupabaseStatus;

  /** Last error string if `status === 'failed'`. */
  @Prop({ type: String, required: false })
  provisioningError?: string;

  /** When provisioning completed successfully. */
  @Prop({ type: Date, required: false })
  readyAt?: Date;

  /**
   * Email of the generated app's admin account, created by the owner from
   * Project settings → Admin. Only the address is stored — the password is
   * handed straight to Supabase Auth and never persisted by Iyona.
   */
  @Prop({ type: String, required: false })
  adminEmail?: string;

  /** When the app admin account was created or last updated. */
  @Prop({ type: Date, required: false })
  adminUpdatedAt?: Date;

  /**
   * Last error encountered when applying the declarative schema via
   * the Supabase Management API. Cleared after a successful apply.
   * Surfaced in the Supabase settings panel.
   */
  @Prop({ type: String, required: false })
  lastSchemaError?: string;

  /**
   * JSON snapshot of the last successfully applied schema declaration.
   * Used for diffing on the next generation to detect additive vs
   * destructive changes. Shape: IyonaSchemaDeclaration (see
   * supabase/interface/supabase-schema.interface.ts).
   */
  @Prop({ type: mongoose.Schema.Types.Mixed, required: false })
  lastAppliedSchema?: Record<string, unknown>;
}
export const SupabaseConfigSchema =
  SchemaFactory.createForClass(SupabaseConfig);

/**
 * Analytics provider config for the deployed app (E13). When set, the
 * preview-bridge in the iframe loads the chosen provider's SDK and
 * starts forwarding `window.iyonaTrack(...)` calls to it.
 *
 * The same values are also injected into the production build at
 * deploy time via `vercel.service.ts` env vars (`VITE_ANALYTICS_*`)
 * so analytics also work outside the workspace iframe.
 */
export type AnalyticsProvider = 'none' | 'plausible' | 'posthog';

@Schema({ _id: false })
export class AnalyticsConfig {
  @Prop({
    type: String,
    enum: ['none', 'plausible', 'posthog'],
    default: 'none',
  })
  provider: AnalyticsProvider;

  /** Plausible: domain (e.g. `myapp.com`). PostHog: project key. */
  @Prop({ type: String, required: false })
  key?: string;

  /** Self-hosted host override. Defaults per provider when empty. */
  @Prop({ type: String, required: false })
  host?: string;
}
export const AnalyticsConfigSchema =
  SchemaFactory.createForClass(AnalyticsConfig);

/**
 * E14 — search-engine + social-share metadata for the deployed app.
 * Persisted on the project; injected into `index.html` and used to
 * generate `robots.txt` + `sitemap.xml` at deploy time.
 */
@Schema({ _id: false })
export class SeoConfig {
  /** `<title>` tag + og:title fallback. Defaults to project name. */
  @Prop({ type: String, required: false })
  title?: string;

  /** `<meta name="description">` + og:description. */
  @Prop({ type: String, required: false })
  description?: string;

  /** Absolute URL for og:image / twitter:image. */
  @Prop({ type: String, required: false })
  ogImage?: string;

  /** twitter:card style. Defaults to `summary_large_image` when set. */
  @Prop({
    type: String,
    enum: ['summary', 'summary_large_image'],
    required: false,
  })
  twitterCard?: 'summary' | 'summary_large_image';

  /**
   * When false, we emit `Disallow: /` in robots.txt and a `noindex`
   * meta tag. Default true (let crawlers index the deployed site).
   */
  @Prop({ type: Boolean, default: true })
  robotsAllow: boolean;

  /** Optional custom canonical URL override. Falls back to deploy URL. */
  @Prop({ type: String, required: false })
  canonical?: string;
}
export const SeoConfigSchema = SchemaFactory.createForClass(SeoConfig);

// Sub-schema for payment configuration
@Schema({ _id: false })
export class PaymentConfig {
  @Prop({ type: Boolean, default: false })
  enabled: boolean;

  @Prop({ type: String, required: false })
  stripePublishableKey?: string;

  @Prop({ type: String, required: false })
  stripeSecretKey?: string; // stored ENCRYPTED via EncryptionService

  @Prop({ type: String, enum: ['test', 'live'], default: 'test' })
  stripeMode: string;

  @Prop({ type: Boolean, default: false })
  connectionValidated: boolean;
}

@Schema({ timestamps: true })
export class UserProject extends Document {
  @Prop({
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  })
  userId: mongoose.Types.ObjectId;

  @Prop({ type: String, required: false })
  name?: string;

  @Prop({ type: String, required: true })
  initialPrompt: string;

  @Prop({
    type: String,
    enum: ProjectStatus,
    default: ProjectStatus.DRAFT,
  })
  status: ProjectStatus;

  // WORKFLOW CONTROL (NEW)
  @Prop({
    type: String,
    enum: ProjectStage,
    default: ProjectStage.CONVERSATION,
  })
  stage: string;

  @Prop({
    type: String,
    enum: StageStatus,
    default: StageStatus.IDLE,
  })
  stageStatus: string;

  @Prop({
    type: [String],
    default: [],
  })
  completedStages: string[];

  @Prop({ type: Boolean, default: false })
  locked: boolean;

  /**
   * AI-generated questionnaire persisted when the workspace saves the payload
   * so the user can resume after navigation (`questions`, optional `estimatedTime`).
   */
  @Prop({ type: mongoose.Schema.Types.Mixed, required: false })
  questionnaire?: Record<string, unknown>;

  /**
   * Resolved language for conversational AI (questionnaire, validation copy).
   * Used with appLocales to steer codegen i18n for the generated Vite app.
   */
  @Prop({ type: String, required: false })
  conversationLocale?: string;

  /**
   * Locales for the generated app: primary = user conversation language when
   * non-English; secondary is usually English for bilingual sites.
   */
  @Prop({
    type: {
      primary: { type: String, required: true },
      secondary: { type: String, required: false },
    },
    required: false,
    _id: false,
  })
  appLocales?: { primary: string; secondary?: string };

  /**
   * Design-system color tokens resolved from the questionnaire's theme picker.
   * Persisted when the first generate-code call includes a designSystem with
   * colors, so downstream consumers (e.g. UI kit injection) can read them
   * without needing the generation request context.
   */
  @Prop({
    type: {
      primary: { type: String, required: false },
      accent: { type: String, required: false },
      background: { type: String, required: false },
      foreground: { type: String, required: false },
    },
    required: false,
    _id: false,
  })
  designSystemColors?: {
    primary?: string;
    accent?: string;
    background?: string;
    foreground?: string;
  };

  // Design style chosen by the user in the questionnaire (font/radius/shadow/
  // surface language). Undefined / 'auto' → deterministic per-project pick.
  // Persisted so revisions and redeploys keep the same look.
  @Prop({ type: String, required: false })
  designStyleId?: string;

  // CURRENT TASK (NEW)
  @Prop({ type: CurrentTask, required: false })
  currentTask?: CurrentTask;

  // CODE GENERATION (NEW)
  @Prop({
    type: Generation,
    default: () => ({
      status: GenerationStatus.NOT_STARTED,
      revision: 0,
      generatedFiles: [],
    }),
  })
  generation: Generation;

  // DEPLOYMENT (EXTENDED)
  @Prop({
    type: DeploymentInfo,
    default: () => ({
      status: WorkflowStatus.NOT_STARTED,
      provider: 'vercel',
    }),
  })
  deployment: DeploymentInfo;

  // EXISTING FIELDS (KEEP)
  @Prop({ type: String, required: false })
  previewUrl?: string;

  @Prop({ type: Number, default: 0 })
  currentRevision: number;

  @Prop({
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Revision',
    required: false,
  })
  latestRevisionId?: mongoose.Types.ObjectId;

  @Prop({
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Deployment',
    required: false,
  })
  latestDeploymentId?: mongoose.Types.ObjectId;

  @Prop({ type: String, required: false })
  framework?: string;

  // PAYMENT CONFIGURATION
  @Prop({
    type: PaymentConfig,
    default: () => ({
      enabled: false,
      stripeMode: 'test',
      connectionValidated: false,
    }),
  })
  paymentConfig: PaymentConfig;

  /**
   * Supabase project bound to this generated app (E1). Null on legacy
   * projects and on new projects that opted out of `withDatabase`.
   */
  @Prop({ type: SupabaseConfigSchema, default: null })
  supabase?: SupabaseConfig | null;

  @Prop({ type: mongoose.Schema.Types.Mixed, required: false })
  metadata?: Record<string, any>;

  /**
   * Encrypted env values for Vercel build-time injection (keys = var names).
   * Plaintext never stored; values are ciphertext via EncryptionService.
   * Keys must appear in repo `.env.example`; see project secrets API.
   */
  @Prop({ type: Object, required: false, default: undefined })
  appBuildSecretsEnc?: Record<string, string>;

  // GITHUB CONFIGURATION (user-connected secondary)
  @Prop({
    type: GitHubConfig,
    default: () => ({ autoPush: false, branch: 'main' }),
  })
  githubConfig: GitHubConfig;

  /**
   * Iyona-owned repo — the canonical codebase for this project.
   * Null until the first generation push. Once set, all deploys read
   * from this repo at a pinned commit SHA.
   */
  // Bucket B (persisted field): the Mongo field name stays `jarvisGithub`.
  // Every existing project document stores the GitHub owner/repo under this key;
  // renaming the property renames the BSON field and orphans that binding for all
  // existing projects (deploys/preview would lose their repo). Keep the key.
  @Prop({ type: IyonaGithubRepoSchema, default: null })
  jarvisGithub?: IyonaGithubRepo | null;

  // PATCH ENGINE FIELDS
  @Prop({ type: Boolean, default: false })
  componentSchemaExtracted: boolean;

  @Prop({ type: Number, default: 0 })
  latestSnapshotVersion: number;

  /**
   * Optional per-project default model. When the user has not picked a
   * specific model for the current message we fall back to this before
   * dropping to the global "Auto" default (catalog.getDefault()).
   */
  @Prop({ type: String, required: false })
  defaultModelId?: string;

  /**
   * Custom domain the project owner has attached to their deployed site.
   * The matching DNS verification state is managed through VercelService.
   */
  @Prop({ type: String, required: false, lowercase: true, trim: true })
  customDomain?: string;

  /**
   * True once Vercel reports the custom domain as verified + resolving.
   */
  @Prop({ type: Boolean, default: false })
  domainVerified?: boolean;

  /**
   * Last known Vercel verification payload (verification + dns records).
   * Stored so the settings page can render DNS instructions without a
   * fresh Vercel round-trip.
   */
  @Prop({ type: mongoose.Schema.Types.Mixed, required: false })
  domainConfig?: Record<string, any>;

  /**
   * Soft-delete marker set by the admin takedown / delete flows. All
   * owner-facing queries in `projects.service.ts` filter this out so the
   * project effectively disappears, but the document is preserved for
   * audit reconstruction.
   */
  @Prop({ type: Date, default: null })
  deletedAt?: Date | null;

  // ──────────────────────────────────────────────────────────────────
  //  E5 — Public projects + Remix + Templates gallery
  // ──────────────────────────────────────────────────────────────────

  /**
   * When true the project is exposed at `/p/:publicSlug` (no auth) and
   * shows up in the public Remix flow. Owner controls this from the
   * workspace.
   */
  @Prop({ type: Boolean, default: false, index: true })
  isPublic: boolean;

  /**
   * Stable URL slug, e.g. `todo-app-a8f3e`. Generated on the first
   * publish. Sparse + unique so unpublished projects stay out of the
   * uniqueness constraint.
   */
  @Prop({
    type: String,
    required: false,
    unique: true,
    sparse: true,
    index: true,
  })
  publicSlug?: string;

  /**
   * Source project this one was remixed from. Null for original
   * creations.
   */
  @Prop({
    type: mongoose.Schema.Types.ObjectId,
    ref: 'UserProject',
    required: false,
    default: null,
  })
  remixOf?: mongoose.Types.ObjectId | null;

  /**
   * Number of times this project has been remixed. Maintained
   * counter-style (no aggregation needed for hot listings).
   */
  @Prop({ type: Number, default: 0 })
  remixCount: number;

  /**
   * Admin-curated templates show up on `/templates`. Mark from the
   * admin project detail page.
   */
  @Prop({ type: Boolean, default: false, index: true })
  isTemplate: boolean;

  /**
   * Optional category for the templates gallery (e.g. `landing`,
   * `dashboard`, `saas`, `ecommerce`).
   */
  @Prop({ type: String, required: false })
  templateCategory?: string;

  /**
   * Short marketing blurb shown on the public project + templates
   * card. Falls back to `initialPrompt` when empty.
   */
  @Prop({ type: String, required: false })
  publicSummary?: string;

  /**
   * Optional analytics provider config (E13). Null/empty means "no
   * tracking" — the deployed app loads no third-party scripts.
   */
  @Prop({ type: AnalyticsConfigSchema, default: () => ({ provider: 'none' }) })
  analytics: AnalyticsConfig;

  /**
   * SEO + social-share metadata for the deployed app (E14). Falls
   * back to sensible defaults (project name as title, robots allow)
   * when the user hasn't customized it yet.
   */
  @Prop({ type: SeoConfigSchema, default: () => ({ robotsAllow: true }) })
  seo: SeoConfig;
}

export const UserProjectSchema = SchemaFactory.createForClass(UserProject);

// E5 — a custom domain may only be attached to one project at a time.
// Without this, two projects could end up pointing at the same hostname
// in Mongo while Vercel only honours one of them, producing a
// confusing split-brain. Sparse so projects without a custom domain
// don't all collide on `null`.
UserProjectSchema.index(
  { customDomain: 1 },
  { unique: true, sparse: true, name: 'customDomain_unique_sparse' },
);
