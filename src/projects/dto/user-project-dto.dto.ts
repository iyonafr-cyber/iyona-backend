import { Expose, Transform, Type } from 'class-transformer';
import { IsMongoId } from 'class-validator';

// Sub-DTO for current task
export class CurrentTaskDto {
  @Expose()
  type?: string;

  @Expose()
  startedAt?: Date;

  @Expose()
  lastHeartbeat?: Date;

  @Expose()
  retryCount: number;
}

// Sub-DTO for generation
export class GenerationDto {
  @Expose()
  status: string;

  @Expose()
  revision: number;

  @Expose()
  generatedFiles: string[];

  @Expose()
  completedAt?: Date;
}

// Sub-DTO for deployment
export class DeploymentInfoDto {
  @Expose()
  status: string;

  @Expose()
  deploymentId?: string;

  @Expose()
  previewUrl?: string;

  @Expose()
  provider: string;

  @Expose()
  completedAt?: Date;
}

// Sub-DTO for GitHub configuration
export class GitHubConfigDto {
  @Expose()
  repository?: string;

  @Expose()
  branch?: string;

  @Expose()
  autoPush: boolean;
}

/**
 * Wire-safe view of a project's Supabase config. The encrypted service
 * role key is intentionally excluded — callers that need it (deploy
 * time env injection, server-side admin tools) read it directly from
 * the entity inside the backend.
 */
export class SupabaseConfigDto {
  @Expose()
  projectRef?: string;

  @Expose()
  url?: string;

  @Expose()
  anonKey?: string;

  @Expose()
  region?: string;

  @Expose()
  status: string;

  @Expose()
  provisioningError?: string;

  @Expose()
  readyAt?: Date;

  /**
   * @deprecated Use lastSchemaError instead. Kept for API compat.
   */
  @Expose()
  lastMigrationError?: string;

  @Expose()
  lastSchemaError?: string;
}

/**
 * E14 — SEO + social-share metadata returned to the workspace so the
 * settings page can hydrate the form and the workspace can preview
 * tags before a redeploy.
 */
export class SeoConfigDto {
  @Expose()
  title?: string;

  @Expose()
  description?: string;

  @Expose()
  ogImage?: string;

  @Expose()
  twitterCard?: 'summary' | 'summary_large_image';

  @Expose()
  robotsAllow: boolean;

  @Expose()
  canonical?: string;
}

/**
 * E13 — analytics provider config exposed to the SPA. Returned on
 * `getProjectById` so the workspace can configure the preview-bridge
 * + render the settings UI.
 */
export class AnalyticsConfigDto {
  @Expose()
  provider: 'none' | 'plausible' | 'posthog';

  @Expose()
  key?: string;

  @Expose()
  host?: string;
}

// Sub-DTO for payment configuration
export class PaymentConfigDto {
  @Expose()
  enabled: boolean;

  @Expose()
  stripePublishableKey?: string;

  @Expose()
  stripeSecretKey?: string;

  @Expose()
  stripeMode: string;

  @Expose()
  connectionValidated: boolean;
}

export class UserProjectDto {
  @Expose()
  @Transform(({ value }) =>
    value === undefined || value === null ? null : String(value),
  )
  @IsMongoId()
  _id: string;

  @Expose()
  @Transform(({ value }) =>
    value === undefined || value === null ? null : String(value),
  )
  userId: string;

  @Expose()
  name?: string;

  @Expose()
  @Transform(({ value }) =>
    value === undefined || value === null ? null : value,
  )
  initialPrompt: string;

  @Expose()
  status?: string;

  // WORKFLOW CONTROL (NEW)
  @Expose()
  stage: string;

  @Expose()
  stageStatus: string;

  @Expose()
  completedStages: string[];

  @Expose()
  locked: boolean;

  @Expose()
  questionnaire?: Record<string, unknown>;

  @Expose()
  conversationLocale?: string;

  @Expose()
  appLocales?: { primary: string; secondary?: string };

  // CURRENT TASK (NEW)
  @Expose()
  @Type(() => CurrentTaskDto)
  currentTask?: CurrentTaskDto;

  // CODE GENERATION (NEW)
  @Expose()
  @Type(() => GenerationDto)
  generation: GenerationDto;

  // DEPLOYMENT (EXTENDED)
  @Expose()
  @Type(() => DeploymentInfoDto)
  deployment: DeploymentInfoDto;

  // EXISTING FIELDS (KEEP)
  @Expose()
  previewUrl?: string;

  @Expose()
  currentRevision: number;

  @Expose()
  @Transform(({ value }) =>
    value === undefined || value === null ? null : String(value),
  )
  latestRevisionId?: string;

  @Expose()
  @Transform(({ value }) =>
    value === undefined || value === null ? null : String(value),
  )
  latestDeploymentId?: string;

  @Expose()
  framework?: string;

  // PAYMENT CONFIGURATION
  @Expose()
  @Type(() => PaymentConfigDto)
  paymentConfig?: PaymentConfigDto;

  // GITHUB CONFIGURATION
  @Expose()
  @Type(() => GitHubConfigDto)
  githubConfig?: GitHubConfigDto;

  // SUPABASE CONFIGURATION (E1)
  @Expose()
  @Type(() => SupabaseConfigDto)
  supabase?: SupabaseConfigDto | null;

  @Expose()
  metadata?: Record<string, any>;

  @Expose()
  defaultModelId?: string;

  @Expose()
  @Transform(({ value }) =>
    value === undefined || value === null ? null : value,
  )
  createdAt: Date;

  @Expose()
  @Transform(({ value }) =>
    value === undefined || value === null ? null : value,
  )
  updatedAt: Date;

  // ── E5 — public projects + remix + templates ───────────────────
  @Expose()
  isPublic?: boolean;

  @Expose()
  publicSlug?: string;

  @Expose()
  @Transform(({ value }) =>
    value === undefined || value === null ? null : String(value),
  )
  remixOf?: string | null;

  @Expose()
  remixCount?: number;

  @Expose()
  isTemplate?: boolean;

  @Expose()
  templateCategory?: string;

  @Expose()
  publicSummary?: string;

  // ANALYTICS CONFIGURATION (E13)
  @Expose()
  @Type(() => AnalyticsConfigDto)
  analytics?: AnalyticsConfigDto;

  // SEO CONFIGURATION (E14)
  @Expose()
  @Type(() => SeoConfigDto)
  seo?: SeoConfigDto;
}
