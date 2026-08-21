import { ApiProperty } from '@nestjs/swagger';
import { Expose, Transform, Type } from 'class-transformer';
import { IsMongoId } from 'class-validator';

// Sub-DTO for current task
export class CurrentTaskDto {
  @ApiProperty({
    type: String,
    enum: ['execution-plan', 'code-generation', 'deployment'],
    required: false,
  })
  @Expose()
  type?: string;

  @ApiProperty({ type: Date, required: false })
  @Expose()
  startedAt?: Date;

  @ApiProperty({ type: Date, required: false })
  @Expose()
  lastHeartbeat?: Date;

  @ApiProperty({ type: Number, default: 0 })
  @Expose()
  retryCount: number;
}

// Sub-DTO for generation
export class GenerationDto {
  @ApiProperty({
    type: String,
    enum: ['not_started', 'in_progress', 'completed', 'failed'],
    default: 'not_started',
  })
  @Expose()
  status: string;

  @ApiProperty({ type: Number, default: 0 })
  @Expose()
  revision: number;

  @ApiProperty({ type: [String], default: [] })
  @Expose()
  generatedFiles: string[];

  @ApiProperty({ type: Date, required: false })
  @Expose()
  completedAt?: Date;
}

// Sub-DTO for deployment
export class DeploymentInfoDto {
  @ApiProperty({
    type: String,
    enum: ['not_started', 'in_progress', 'completed', 'failed'],
    default: 'not_started',
  })
  @Expose()
  status: string;

  @ApiProperty({ type: String, required: false })
  @Expose()
  deploymentId?: string;

  @ApiProperty({ type: String, required: false })
  @Expose()
  previewUrl?: string;

  @ApiProperty({ type: String, default: 'vercel' })
  @Expose()
  provider: string;

  @ApiProperty({ type: Date, required: false })
  @Expose()
  completedAt?: Date;
}

// Sub-DTO for GitHub configuration
export class GitHubConfigDto {
  @ApiProperty({ type: String, required: false })
  @Expose()
  repository?: string;

  @ApiProperty({ type: String, required: false, default: 'main' })
  @Expose()
  branch?: string;

  @ApiProperty({ type: Boolean, default: false })
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
  @ApiProperty({ type: String, required: false })
  @Expose()
  projectRef?: string;

  @ApiProperty({ type: String, required: false })
  @Expose()
  url?: string;

  @ApiProperty({ type: String, required: false })
  @Expose()
  anonKey?: string;

  @ApiProperty({ type: String, required: false })
  @Expose()
  region?: string;

  @ApiProperty({
    type: String,
    enum: ['pending', 'provisioning', 'ready', 'failed'],
  })
  @Expose()
  status: string;

  @ApiProperty({ type: String, required: false })
  @Expose()
  provisioningError?: string;

  @ApiProperty({ type: Date, required: false })
  @Expose()
  readyAt?: Date;

  /**
   * @deprecated Use lastSchemaError instead. Kept for API compat.
   */
  @ApiProperty({
    type: String,
    required: false,
    description: 'Deprecated — use lastSchemaError.',
  })
  @Expose()
  lastMigrationError?: string;

  @ApiProperty({
    type: String,
    required: false,
    description:
      'Last error from applying the declarative schema on deploy. Null ' +
      'when the most recent deploy succeeded cleanly.',
  })
  @Expose()
  lastSchemaError?: string;
}

/**
 * E14 — SEO + social-share metadata returned to the workspace so the
 * settings page can hydrate the form and the workspace can preview
 * tags before a redeploy.
 */
export class SeoConfigDto {
  @ApiProperty({ type: String, required: false })
  @Expose()
  title?: string;

  @ApiProperty({ type: String, required: false })
  @Expose()
  description?: string;

  @ApiProperty({ type: String, required: false })
  @Expose()
  ogImage?: string;

  @ApiProperty({
    type: String,
    enum: ['summary', 'summary_large_image'],
    required: false,
  })
  @Expose()
  twitterCard?: 'summary' | 'summary_large_image';

  @ApiProperty({ type: Boolean, default: true })
  @Expose()
  robotsAllow: boolean;

  @ApiProperty({ type: String, required: false })
  @Expose()
  canonical?: string;
}

/**
 * E13 — analytics provider config exposed to the SPA. Returned on
 * `getProjectById` so the workspace can configure the preview-bridge
 * + render the settings UI.
 */
export class AnalyticsConfigDto {
  @ApiProperty({
    type: String,
    enum: ['none', 'plausible', 'posthog'],
    default: 'none',
  })
  @Expose()
  provider: 'none' | 'plausible' | 'posthog';

  @ApiProperty({ type: String, required: false })
  @Expose()
  key?: string;

  @ApiProperty({ type: String, required: false })
  @Expose()
  host?: string;
}

// Sub-DTO for payment configuration
export class PaymentConfigDto {
  @ApiProperty({ type: Boolean, default: false })
  @Expose()
  enabled: boolean;

  @ApiProperty({ type: String, required: false })
  @Expose()
  stripePublishableKey?: string;

  @ApiProperty({
    type: String,
    required: false,
    description: 'Masked secret key (last 4 chars only)',
  })
  @Expose()
  stripeSecretKey?: string;

  @ApiProperty({ type: String, enum: ['test', 'live'], default: 'test' })
  @Expose()
  stripeMode: string;

  @ApiProperty({ type: Boolean, default: false })
  @Expose()
  connectionValidated: boolean;
}

export class UserProjectDto {
  @ApiProperty({
    type: String,
    description: 'Project ID (MongoDB ObjectId)',
    example: '507f1f77bcf86cd799439011',
  })
  @Expose()
  @Transform(({ value }) =>
    value === undefined || value === null ? null : String(value),
  )
  @IsMongoId()
  _id: string;

  @ApiProperty({
    type: String,
    description: 'User ID (MongoDB ObjectId)',
    example: '507f1f77bcf86cd799439011',
  })
  @Expose()
  @Transform(({ value }) =>
    value === undefined || value === null ? null : String(value),
  )
  userId: string;

  @ApiProperty({
    type: String,
    description: 'Project name',
    required: false,
  })
  @Expose()
  name?: string;

  @ApiProperty({
    type: String,
    description: 'Initial prompt for the project',
    example: 'Create a web application for task management',
  })
  @Expose()
  @Transform(({ value }) =>
    value === undefined || value === null ? null : value,
  )
  initialPrompt: string;

  @ApiProperty({
    type: String,
    enum: ['DRAFT', 'BUILDING', 'DEPLOYED', 'FAILED'],
    description: 'Project status',
  })
  @Expose()
  status?: string;

  // WORKFLOW CONTROL (NEW)
  @ApiProperty({
    type: String,
    enum: [
      'conversation',
      'questionnaire-ready',
      'questionnaire',
      'execution-plan',
      'code-generation',
      'deployment',
      'deployed',
      'failed',
    ],
    default: 'conversation',
  })
  @Expose()
  stage: string;

  @ApiProperty({
    type: String,
    enum: ['idle', 'in_progress', 'completed', 'failed'],
    default: 'idle',
  })
  @Expose()
  stageStatus: string;

  @ApiProperty({
    type: [String],
    default: [],
  })
  @Expose()
  completedStages: string[];

  @ApiProperty({ type: Boolean, default: false })
  @Expose()
  locked: boolean;

  @ApiProperty({
    type: Object,
    required: false,
    description:
      'Persisted questionnaire (questions + optional estimatedTime) for resume flows',
  })
  @Expose()
  questionnaire?: Record<string, unknown>;

  @ApiProperty({
    type: String,
    required: false,
    description: 'Resolved conversation locale for AI + generated app i18n',
    example: 'fr',
  })
  @Expose()
  conversationLocale?: string;

  @ApiProperty({
    required: false,
    description: 'Primary and optional secondary locale for the generated app',
    example: { primary: 'fr', secondary: 'en' },
  })
  @Expose()
  appLocales?: { primary: string; secondary?: string };

  // CURRENT TASK (NEW)
  @ApiProperty({ type: CurrentTaskDto, required: false })
  @Expose()
  @Type(() => CurrentTaskDto)
  currentTask?: CurrentTaskDto;

  // CODE GENERATION (NEW)
  @ApiProperty({ type: GenerationDto })
  @Expose()
  @Type(() => GenerationDto)
  generation: GenerationDto;

  // DEPLOYMENT (EXTENDED)
  @ApiProperty({ type: DeploymentInfoDto })
  @Expose()
  @Type(() => DeploymentInfoDto)
  deployment: DeploymentInfoDto;

  // EXISTING FIELDS (KEEP)
  @ApiProperty({ type: String, required: false })
  @Expose()
  previewUrl?: string;

  @ApiProperty({ type: Number, default: 0 })
  @Expose()
  currentRevision: number;

  @ApiProperty({
    type: String,
    required: false,
    description: 'Latest revision ID',
  })
  @Expose()
  @Transform(({ value }) =>
    value === undefined || value === null ? null : String(value),
  )
  latestRevisionId?: string;

  @ApiProperty({
    type: String,
    required: false,
    description: 'Latest deployment ID',
  })
  @Expose()
  @Transform(({ value }) =>
    value === undefined || value === null ? null : String(value),
  )
  latestDeploymentId?: string;

  @ApiProperty({ type: String, required: false })
  @Expose()
  framework?: string;

  // PAYMENT CONFIGURATION
  @ApiProperty({ type: PaymentConfigDto, required: false })
  @Expose()
  @Type(() => PaymentConfigDto)
  paymentConfig?: PaymentConfigDto;

  // GITHUB CONFIGURATION
  @ApiProperty({ type: GitHubConfigDto, required: false })
  @Expose()
  @Type(() => GitHubConfigDto)
  githubConfig?: GitHubConfigDto;

  // SUPABASE CONFIGURATION (E1)
  @ApiProperty({ type: SupabaseConfigDto, required: false, nullable: true })
  @Expose()
  @Type(() => SupabaseConfigDto)
  supabase?: SupabaseConfigDto | null;

  @ApiProperty({
    type: Object,
    description: 'Additional metadata',
    required: false,
  })
  @Expose()
  metadata?: Record<string, any>;

  @ApiProperty({
    type: String,
    description: 'Per-project default AI model (modelId from catalog)',
    required: false,
  })
  @Expose()
  defaultModelId?: string;

  @ApiProperty({
    type: Date,
    description: 'Creation timestamp',
  })
  @Expose()
  @Transform(({ value }) =>
    value === undefined || value === null ? null : value,
  )
  createdAt: Date;

  @ApiProperty({
    type: Date,
    description: 'Last update timestamp',
  })
  @Expose()
  @Transform(({ value }) =>
    value === undefined || value === null ? null : value,
  )
  updatedAt: Date;

  // ── E5 — public projects + remix + templates ───────────────────
  @ApiProperty({ type: Boolean, default: false })
  @Expose()
  isPublic?: boolean;

  @ApiProperty({ type: String, required: false })
  @Expose()
  publicSlug?: string;

  @ApiProperty({
    type: String,
    required: false,
    description: 'Source project this one was remixed from.',
  })
  @Expose()
  @Transform(({ value }) =>
    value === undefined || value === null ? null : String(value),
  )
  remixOf?: string | null;

  @ApiProperty({ type: Number, default: 0 })
  @Expose()
  remixCount?: number;

  @ApiProperty({ type: Boolean, default: false })
  @Expose()
  isTemplate?: boolean;

  @ApiProperty({ type: String, required: false })
  @Expose()
  templateCategory?: string;

  @ApiProperty({ type: String, required: false })
  @Expose()
  publicSummary?: string;

  // ANALYTICS CONFIGURATION (E13)
  @ApiProperty({ type: AnalyticsConfigDto, required: false })
  @Expose()
  @Type(() => AnalyticsConfigDto)
  analytics?: AnalyticsConfigDto;

  // SEO CONFIGURATION (E14)
  @ApiProperty({ type: SeoConfigDto, required: false })
  @Expose()
  @Type(() => SeoConfigDto)
  seo?: SeoConfigDto;
}
