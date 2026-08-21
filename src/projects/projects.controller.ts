import {
  Controller,
  Get,
  Put,
  Post,
  Param,
  Delete,
  Body,
  UseGuards,
  Query,
  Res,
  HttpCode,
  HttpStatus,
  HttpException,
} from '@nestjs/common';
import { ProjectsService } from './projects.service';
import { ProjectPatchService } from './project-patch.service';
import { PublicProjectsService } from './public-projects.service';
import { ProjectSettingsService } from './project-settings.service';
import {
  ApiOperation,
  ApiTags,
  ApiBearerAuth,
  ApiResponse,
} from '@nestjs/swagger';
import { UserProjectDto } from './dto/user-project-dto.dto';
import { CreateUserProjectDto } from './dto/create-user-project.dto';
import { UpdateUserProjectDto } from './dto/update-user-project.dto';
import { UpdatePaymentConfigDto } from './dto/update-payment-config.dto';
import {
  CompleteCodeGenerationDto,
  CompleteDeploymentDto,
  FailStageDto,
} from './dto/workflow.dto';
import { SaveQuestionnaireDto } from './dto/save-questionnaire.dto';
import { UpdateAnalyticsDto } from './dto/update-analytics.dto';
import { UpdateSeoDto } from './dto/update-seo.dto';
import { UpdateGitHubConfigDto } from './dto/update-github-config.dto';
import { UpdateProjectSecretsDto } from './dto/update-project-secrets.dto';
import { SetAppAdminDto } from './dto/set-app-admin.dto';
import { ConnectSupabaseDto } from './dto/connect-supabase.dto';
import {
  SupabaseConnectionService,
  type ConnectSupabaseResult,
  type SupabaseConnectionStatus,
} from './supabase-connection.service';
import {
  isManagedProvisioningEnabled,
  MANAGED_PROVISIONING_DISABLED_MESSAGE,
} from 'src/supabase/managed-provisioning.flag';
import { ProjectSecretsResponseDto } from './dto/project-secrets-response.dto';
import { PaginationQueryDto } from './dto/pagination-query.dto';
import {
  ExtractSchemaDto,
  RollbackComponentDto,
} from './dto/patch.dto';
import { AuthGuard } from 'src/auth/guards/auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorator/roles.decorator';
import { UserRole } from 'src/user/roles/roles.enum';
import {
  CurrentUser,
  CurrentUserPayload,
} from 'src/auth/decorator/current-user.decorator';
import { Response } from 'express';
import { CreditsGuard } from '../credits/guards/credits.guard';
import { CreditAction } from '../credits/decorator/credit-action.decorator';
import { RemixProjectDto, SetPublicProjectDto } from './dto/public-project.dto';
import { ProjectErrorsService } from './project-errors.service';
import { ProjectAccessService } from './project-access.service';
import {
  FeatureFlagsGuard,
  RequireFeatureFlag,
} from '../organizations/feature-flags.guard';
import {
  LogProjectErrorDto,
  ProjectErrorDto,
  UpdateProjectErrorDto,
} from './dto/project-error.dto';
import { ProjectErrorStatus } from './entities/project-error.entity';

@ApiTags('Projects')
@ApiBearerAuth('JWT-auth')
@UseGuards(AuthGuard, RolesGuard)
@Roles(UserRole.USER)
@Controller('projects')
export class ProjectsController {
  constructor(
    private readonly projectsService: ProjectsService,
    private readonly projectErrorsService: ProjectErrorsService,
    private readonly projectAccessService: ProjectAccessService,
    private readonly projectPatchService: ProjectPatchService,
    private readonly publicProjectsService: PublicProjectsService,
    private readonly projectSettingsService: ProjectSettingsService,
    private readonly supabaseConnectionService: SupabaseConnectionService,
  ) {}

  @ApiOperation({ summary: 'Get all projects with pagination' })
  @ApiResponse({
    status: 200,
    description: 'Returns paginated projects',
    schema: {
      type: 'object',
      properties: {
        data: {
          type: 'array',
          items: { $ref: '#/components/schemas/UserProjectDto' },
        },
        total: { type: 'number', example: 25 },
        page: { type: 'number', example: 1 },
        limit: { type: 'number', example: 10 },
        totalPages: { type: 'number', example: 3 },
        hasMore: { type: 'boolean', example: true },
      },
    },
  })
  @Get()
  @HttpCode(HttpStatus.OK)
  async getAllProjects(
    @Query() paginationQuery: PaginationQueryDto,
    @CurrentUser() user: CurrentUserPayload,
    @Res() res: Response,
  ): Promise<void> {
    const page = paginationQuery.page || 1;
    const limit = paginationQuery.limit || 20;
    const result = await this.projectsService.getAllProjects(
      user.userId,
      page,
      limit,
    );
    res.json(result);
  }

  @ApiOperation({
    summary:
      'List the caller’s soft-deleted projects still inside the restore window',
  })
  @ApiResponse({
    status: 200,
    description: 'Soft-deleted projects',
    schema: {
      type: 'object',
      properties: {
        data: {
          type: 'array',
          items: { $ref: '#/components/schemas/UserProjectDto' },
        },
        total: { type: 'number', example: 3 },
      },
    },
  })
  // Static path declared BEFORE `:id` so NestJS doesn't try to load
  // a project literally named "deleted".
  @Get('deleted')
  async getDeletedProjects(
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ data: UserProjectDto[]; total: number }> {
    return this.projectsService.listDeletedProjects(user.userId);
  }

  @ApiOperation({ summary: 'Get project by id' })
  @Get(':id')
  async getProjectById(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ data: UserProjectDto }> {
    const project = await this.projectsService.getProjectById(id, user.userId);
    return { data: project };
  }

  @ApiOperation({ summary: 'Create a new project' })
  @Post()
  async createProject(
    @Body() createUserProjectDto: CreateUserProjectDto,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ data: UserProjectDto }> {
    const project = await this.projectsService.createProject(
      createUserProjectDto,
      user.userId,
    );
    return { data: project };
  }

  @ApiOperation({ summary: 'Update a project by id' })
  @Put(':id')
  async updateProject(
    @Param('id') id: string,
    @Body() updateData: UpdateUserProjectDto,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ data: UserProjectDto }> {
    const project = await this.projectsService.updateProject(
      id,
      user.userId,
      updateData,
    );
    return { data: project };
  }

  @ApiOperation({ summary: 'Delete project by id' })
  @Delete(':id')
  async deleteProject(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ message: string }> {
    await this.projectsService.deleteProject(id, user.userId);
    return { message: 'Project deleted successfully' };
  }

  @ApiOperation({
    summary: 'Restore a soft-deleted project (within the retention window)',
  })
  @ApiResponse({
    status: 200,
    description: 'Project restored',
    type: UserProjectDto,
  })
  @Post(':id/restore')
  async restoreProject(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ data: UserProjectDto }> {
    const project = await this.projectsService.restoreProject(id, user.userId);
    return { data: project };
  }

  // ==================== WORKFLOW ENDPOINTS ====================

  @ApiOperation({ summary: 'Start questionnaire stage' })
  @ApiResponse({
    status: 200,
    description: 'Questionnaire stage started',
    type: UserProjectDto,
  })
  @Post(':id/workflow/start-questionnaire')
  async startQuestionnaire(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ data: UserProjectDto }> {
    const project = await this.projectsService.startQuestionnaire(
      id,
      user.userId,
    );
    return { data: project };
  }

  @ApiOperation({
    summary:
      'Save generated questionnaire on the project (questionnaire-ready)',
  })
  @ApiResponse({
    status: 200,
    description: 'Questionnaire persisted; user can resume before answering',
    type: UserProjectDto,
  })
  @Post(':id/workflow/save-questionnaire')
  async saveQuestionnaire(
    @Param('id') id: string,
    @Body() body: SaveQuestionnaireDto,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ data: UserProjectDto }> {
    const project = await this.projectsService.saveQuestionnaire(
      id,
      user.userId,
      body,
    );
    return { data: project };
  }

  @ApiOperation({ summary: 'Complete questionnaire and start execution plan' })
  @ApiResponse({
    status: 200,
    description:
      'Questionnaire completed, execution plan started automatically',
    type: UserProjectDto,
  })
  @Post(':id/workflow/complete-questionnaire')
  async completeQuestionnaire(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ data: UserProjectDto }> {
    const project = await this.projectsService.completeQuestionnaire(
      id,
      user.userId,
    );
    return { data: project };
  }

  @ApiOperation({
    summary: 'Complete execution plan and start code generation',
  })
  @ApiResponse({
    status: 200,
    description:
      'Execution plan completed, code generation started automatically',
    type: UserProjectDto,
  })
  @Post(':id/workflow/complete-execution-plan')
  async completeExecutionPlan(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ data: UserProjectDto }> {
    const project = await this.projectsService.completeExecutionPlan(
      id,
      user.userId,
    );
    return { data: project };
  }

  @ApiOperation({
    summary: 'Complete code generation and start deployment',
  })
  @ApiResponse({
    status: 200,
    description: 'Code generation completed, deployment started automatically',
    type: UserProjectDto,
  })
  @Post(':id/workflow/complete-code-generation')
  async completeCodeGeneration(
    @Param('id') id: string,
    @Body() body: CompleteCodeGenerationDto,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ data: UserProjectDto }> {
    const project = await this.projectsService.completeCodeGeneration(
      id,
      user.userId,
      body.generatedFiles,
    );
    return { data: project };
  }

  @ApiOperation({ summary: 'Complete deployment and mark project as deployed' })
  @ApiResponse({
    status: 200,
    description: 'Deployment completed, project is now deployed',
    type: UserProjectDto,
  })
  @Post(':id/workflow/complete-deployment')
  async completeDeployment(
    @Param('id') id: string,
    @Body() body: CompleteDeploymentDto,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ data: UserProjectDto }> {
    const project = await this.projectsService.completeDeployment(
      id,
      user.userId,
      body.deploymentId,
      body.previewUrl,
    );
    return { data: project };
  }

  @ApiOperation({ summary: 'Update heartbeat for current task' })
  @ApiResponse({
    status: 200,
    description: 'Heartbeat updated',
    type: UserProjectDto,
  })
  @Post(':id/workflow/heartbeat')
  async updateHeartbeat(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ data: UserProjectDto }> {
    const project = await this.projectsService.updateHeartbeat(id, user.userId);
    return { data: project };
  }

  @ApiOperation({ summary: 'Mark stage as failed' })
  @ApiResponse({
    status: 200,
    description: 'Stage marked as failed',
    type: UserProjectDto,
  })
  @Post(':id/workflow/fail-stage')
  async failStage(
    @Param('id') id: string,
    @Body() body: FailStageDto,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ data: UserProjectDto }> {
    const project = await this.projectsService.failStage(
      id,
      user.userId,
      body.errorMessage,
    );
    return { data: project };
  }

  @ApiOperation({ summary: 'Retry a failed stage' })
  @ApiResponse({
    status: 200,
    description: 'Stage retry initiated',
    type: UserProjectDto,
  })
  @Post(':id/workflow/retry-stage')
  async retryStage(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ data: UserProjectDto }> {
    const project = await this.projectsService.retryStage(id, user.userId);
    return { data: project };
  }

  @ApiOperation({
    summary: 'Check and recover stalled project',
  })
  @ApiResponse({
    status: 200,
    description: 'Project checked and recovered if stalled',
    type: UserProjectDto,
  })
  @Post(':id/workflow/check-stalled')
  async checkStalledProject(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ data: UserProjectDto }> {
    const project = await this.projectsService.checkAndRecoverStalledProject(
      id,
      user.userId,
    );
    return { data: project };
  }

  @ApiOperation({ summary: 'Check if chat input is enabled for project' })
  @ApiResponse({
    status: 200,
    description: 'Returns whether chat is enabled',
    schema: {
      type: 'object',
      properties: {
        enabled: { type: 'boolean' },
      },
    },
  })
  @Get(':id/workflow/chat-enabled')
  async isChatEnabled(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ enabled: boolean }> {
    const enabled = await this.projectsService.isChatEnabled(id, user.userId);
    return { enabled };
  }

  // ==================== PAYMENT CONFIGURATION ENDPOINTS ====================

  @ApiOperation({ summary: 'Get payment configuration for a project' })
  @ApiResponse({
    status: 200,
    description: 'Returns payment configuration (secret key masked)',
    type: UserProjectDto,
  })
  @Get(':id/payment-config')
  async getPaymentConfig(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ data: UserProjectDto }> {
    const project = await this.projectSettingsService.getPaymentConfig(
      id,
      user.userId,
    );
    return { data: project };
  }

  @ApiOperation({ summary: 'Update payment configuration for a project' })
  @ApiResponse({
    status: 200,
    description: 'Payment configuration updated',
    type: UserProjectDto,
  })
  // PR-1.8: built-app Stripe is gated behind the `builtAppStripe` org
  // feature flag for launch. Reads (`GET payment-config`) intentionally
  // stay open so previously-configured projects don't break in the UI;
  // mutations require the workspace to opt in.
  @UseGuards(FeatureFlagsGuard)
  @RequireFeatureFlag('builtAppStripe')
  @Put(':id/payment-config')
  async updatePaymentConfig(
    @Param('id') id: string,
    @Body() updatePaymentConfigDto: UpdatePaymentConfigDto,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ data: UserProjectDto }> {
    const project = await this.projectSettingsService.updatePaymentConfig(
      id,
      user.userId,
      updatePaymentConfigDto,
    );
    return { data: project };
  }

  @ApiOperation({ summary: 'Validate Stripe connection for a project' })
  @ApiResponse({
    status: 200,
    description: 'Stripe connection validation result',
    schema: {
      type: 'object',
      properties: {
        valid: { type: 'boolean' },
        message: { type: 'string' },
      },
    },
  })
  @UseGuards(FeatureFlagsGuard)
  @RequireFeatureFlag('builtAppStripe')
  @Post(':id/payment-config/validate')
  async validateStripeConnection(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ valid: boolean; message: string }> {
    return this.projectSettingsService.validateStripeConnection(id, user.userId);
  }

  // ==================== PROJECT BUILD SECRETS (.env.example) ====================

  @ApiOperation({
    summary:
      'Get build secrets manifest from .env.example (keys, isSet, deployable, orphans)',
  })
  @ApiResponse({ status: 200, type: ProjectSecretsResponseDto })
  @Get(':id/secrets')
  async getProjectSecrets(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ data: ProjectSecretsResponseDto }> {
    const data = await this.projectSettingsService.getProjectSecrets(id, user.userId);
    return { data };
  }

  @ApiOperation({
    summary:
      'Set or update build secrets (values must be declared in .env.example)',
  })
  @ApiResponse({ status: 200, type: ProjectSecretsResponseDto })
  @Put(':id/secrets')
  async updateProjectSecrets(
    @Param('id') id: string,
    @Body() dto: UpdateProjectSecretsDto,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ data: ProjectSecretsResponseDto }> {
    const data = await this.projectSettingsService.updateProjectSecrets(
      id,
      user.userId,
      dto,
    );
    return { data };
  }

  @ApiOperation({ summary: 'Delete one stored build secret by key name' })
  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete(':id/secrets/:key')
  async deleteProjectSecret(
    @Param('id') id: string,
    @Param('key') key: string,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<void> {
    await this.projectSettingsService.deleteProjectSecret(id, user.userId, key);
  }

  // ==================== ANALYTICS CONFIGURATION (E13) ====================

  /**
   * Attach a third-party analytics provider (Plausible / PostHog) to
   * the deployed app. The change is persisted on `UserProject.analytics`
   * and pushed into Vercel build env on the next deploy. The workspace
   * also forwards it to the preview-bridge so the iframe can mirror
   * the provider in real time.
   */
  @ApiOperation({
    summary: 'Update analytics configuration for a project (E13)',
  })
  @ApiResponse({ status: 200, type: UserProjectDto })
  @Put(':id/analytics')
  async updateAnalytics(
    @Param('id') id: string,
    @Body() dto: UpdateAnalyticsDto,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ data: UserProjectDto }> {
    const project = await this.projectSettingsService.updateAnalyticsConfig(
      id,
      user.userId,
      dto,
    );
    return { data: project };
  }

  // ==================== SEO CONFIGURATION (E14) ====================

  /**
   * Update SEO + social-share metadata for the deployed app. Stored
   * on `UserProject.seo`; injected into `index.html` and rolled into
   * `robots.txt` + `sitemap.xml` on the next deploy.
   */
  @ApiOperation({ summary: 'Update SEO configuration for a project (E14)' })
  @ApiResponse({ status: 200, type: UserProjectDto })
  @Put(':id/seo')
  async updateSeo(
    @Param('id') id: string,
    @Body() dto: UpdateSeoDto,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ data: UserProjectDto }> {
    const project = await this.projectSettingsService.updateSeoConfig(
      id,
      user.userId,
      dto,
    );
    return { data: project };
  }

  @ApiOperation({
    summary:
      'Update GitHub config for a project (persist repo handle, toggle auto-push)',
  })
  @ApiResponse({
    status: 200,
    description: 'Updated project',
    type: UserProjectDto,
  })
  @Put(':id/github-config')
  async updateGitHubConfig(
    @Param('id') id: string,
    @Body() dto: UpdateGitHubConfigDto,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ data: UserProjectDto }> {
    const project = await this.projectSettingsService.updateGitHubConfig(
      id,
      user.userId,
      dto,
    );
    return { data: project };
  }

  // ==================== PATCH ENGINE ENDPOINTS ====================

  @ApiOperation({ summary: 'Extract component schema from generated files' })
  @ApiResponse({
    status: 200,
    description: 'Schema extracted successfully',
  })
  @UseGuards(CreditsGuard)
  @CreditAction('schema_extract')
  @Post(':id/schema/extract')
  async extractSchema(
    @Param('id') id: string,
    @Body() extractSchemaDto: ExtractSchemaDto,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<any> {
    const { schemas, meta } = await this.projectPatchService.extractSchema(
      id,
      user.userId,
      extractSchemaDto,
    );
    return { data: schemas, meta };
  }

  @ApiOperation({ summary: 'Get all components for a project' })
  @ApiResponse({
    status: 200,
    description: 'Returns all components',
  })
  @Get(':id/components')
  async getComponents(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<any> {
    return this.projectPatchService.getComponents(id, user.userId);
  }

  @ApiOperation({ summary: 'Get version history for a component' })
  @ApiResponse({
    status: 200,
    description: 'Returns component version history',
  })
  @Get(':id/components/:componentId/versions')
  async getComponentVersions(
    @Param('id') id: string,
    @Param('componentId') componentId: string,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<any> {
    return this.projectPatchService.getComponentVersions(
      id,
      user.userId,
      componentId,
    );
  }

  @ApiOperation({ summary: 'Rollback a component to a previous version' })
  @ApiResponse({
    status: 200,
    description: 'Component rolled back successfully',
  })
  @Post(':id/components/:componentId/rollback')
  async rollbackComponent(
    @Param('id') id: string,
    @Param('componentId') componentId: string,
    @Body() rollbackDto: RollbackComponentDto,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<any> {
    return this.projectPatchService.rollbackComponent(
      id,
      user.userId,
      componentId,
      rollbackDto.version,
    );
  }

  @ApiOperation({ summary: 'Get all snapshots for a project' })
  @ApiResponse({
    status: 200,
    description: 'Returns all project snapshots',
  })
  @Get(':id/snapshots')
  async getSnapshots(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<any> {
    return this.projectPatchService.getSnapshots(id, user.userId);
  }

  @ApiOperation({ summary: 'Rollback project to a snapshot version' })
  @ApiResponse({
    status: 200,
    description: 'Project rolled back successfully',
  })
  @Post(':id/snapshots/:version/rollback')
  async rollbackProject(
    @Param('id') id: string,
    @Param('version') version: number,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<any> {
    return this.projectPatchService.rollbackProject(id, user.userId, version);
  }

  @ApiOperation({
    summary: 'Diff a snapshot against current project state (E2)',
    description:
      'Returns one entry per file path with before/after text and a status label, suitable for a Monaco DiffEditor review UI.',
  })
  @ApiResponse({ status: 200, description: 'Per-file diff against snapshot.' })
  @Get(':id/snapshots/:version/diff')
  async diffSnapshot(
    @Param('id') id: string,
    @Param('version') version: number,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<any> {
    return this.projectPatchService.diffSnapshot(id, user.userId, version);
  }

  @ApiOperation({
    summary: 'Partial revert: revert a subset of files to a snapshot (E2)',
    description:
      'Saves the current state as a safety snapshot, then reverts only the listed file paths to the version stored in the target snapshot. Files added after the snapshot are deleted when listed.',
  })
  @ApiResponse({
    status: 200,
    description: 'Returns the updated full file map.',
  })
  @Post(':id/snapshots/:version/revert-files')
  async revertSnapshotFiles(
    @Param('id') id: string,
    @Param('version') version: number,
    @Body() body: { filePaths: string[] },
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<any> {
    return this.projectPatchService.revertSnapshotFiles(
      id,
      user.userId,
      version,
      body?.filePaths,
    );
  }

  // ──────────────────────────────────────────────────────────────────
  //  E5 — Public projects + remix
  // ──────────────────────────────────────────────────────────────────

  @ApiOperation({
    summary:
      'Publish or unpublish a project (toggle isPublic + allocate slug on first publish).',
  })
  @ApiResponse({ status: 200, type: UserProjectDto })
  @Put(':id/public')
  async setPublic(
    @Param('id') id: string,
    @Body() dto: SetPublicProjectDto,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ data: UserProjectDto }> {
    const project = await this.publicProjectsService.setPublicVisibility(
      id,
      user.userId,
      dto,
    );
    return { data: project };
  }

  @ApiOperation({
    summary:
      'Remix a public/template project into a brand-new project owned by the caller.',
  })
  @ApiResponse({ status: 201, type: UserProjectDto })
  @Post(':id/remix')
  async remix(
    @Param('id') id: string,
    @Body() dto: RemixProjectDto,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ data: UserProjectDto }> {
    const project = await this.publicProjectsService.remixProject(
      id,
      user.userId,
      dto,
    );
    return { data: project };
  }

  // ──────────────────────────────────────────────────────────────────
  //  E3 — Runtime error capture (preview-bridge → server)
  // ──────────────────────────────────────────────────────────────────

  @ApiOperation({
    summary:
      "Log a runtime error captured by the deployed app's preview-bridge.",
  })
  @ApiResponse({ status: 201, type: ProjectErrorDto })
  @Post(':id/errors')
  @HttpCode(HttpStatus.CREATED)
  async logProjectError(
    @Param('id') id: string,
    @Body() dto: LogProjectErrorDto,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ data: ProjectErrorDto }> {
    // Viewer access is sufficient — anybody who can preview the
    // project can also report errors that fired in their own
    // browser. We still need *some* check so unrelated users can't
    // pollute another project's error list.
    await this.projectAccessService.requireViewer(user.userId, id);
    const data = await this.projectErrorsService.log(id, user.userId, dto);
    return { data };
  }

  @ApiOperation({ summary: 'List recent runtime errors for a project.' })
  @ApiResponse({ status: 200, type: ProjectErrorDto, isArray: true })
  @Get(':id/errors')
  async listProjectErrors(
    @Param('id') id: string,
    @Query('status') status: ProjectErrorStatus | undefined,
    @Query('limit') limit: string | undefined,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ data: ProjectErrorDto[] }> {
    await this.projectAccessService.requireViewer(user.userId, id);
    const data = await this.projectErrorsService.list(id, {
      status,
      limit: limit ? Number(limit) : undefined,
    });
    return { data };
  }

  @ApiOperation({
    summary: 'Update a project error (dismiss, resolve, or mark sent-to-chat).',
  })
  @ApiResponse({ status: 200, type: ProjectErrorDto })
  @Put(':id/errors/:errorId')
  async updateProjectError(
    @Param('id') id: string,
    @Param('errorId') errorId: string,
    @Body() dto: UpdateProjectErrorDto,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ data: ProjectErrorDto }> {
    // Mutating error state (dismiss / resolve / mark sent-to-chat) is a
    // workspace action, not a "read what fired in my browser" action —
    // require owner-or-admin to prevent any project member with viewer
    // access from clearing another collaborator's error queue.
    await this.projectAccessService.requireOwnerOrAdmin(user.userId, id);
    const data = await this.projectErrorsService.patch(id, errorId, dto);
    return { data };
  }

  // ─── Generated app admin account ───────────────────────────────────────

  @ApiOperation({
    summary:
      "State of the generated app's admin account. `supported` is false when " +
      'the project has no database (mock-auth apps keep demo credentials in ' +
      'their own source).',
  })
  @ApiResponse({ status: 200, description: 'Admin account state' })
  @Get(':id/app-admin')
  async getAppAdmin(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{
    data: {
      supported: boolean;
      /** False when the project has a database but not the credentials needed. */
      canManage: boolean;
      configured: boolean;
      email?: string;
      updatedAt?: Date;
      reason?: string;
    };
  }> {
    await this.projectAccessService.requireOwnerOrAdmin(user.userId, id);
    const data = await this.projectsService.getAppAdmin(id, user.userId);
    return { data };
  }

  @ApiOperation({
    summary:
      "Create the generated app's admin account, or reset its password. The " +
      'password is passed to Supabase Auth and never stored by Jarvis.',
  })
  @ApiResponse({ status: 200, description: 'Admin account created or updated' })
  @Post(':id/app-admin')
  @HttpCode(HttpStatus.OK)
  async setAppAdmin(
    @Param('id') id: string,
    @Body() dto: SetAppAdminDto,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{
    data: { email: string; created: boolean; updatedAt: Date };
  }> {
    await this.projectAccessService.requireOwnerOrAdmin(user.userId, id);
    const data = await this.projectsService.setAppAdmin(
      id,
      user.userId,
      dto.email.trim().toLowerCase(),
      dto.password,
    );
    return { data };
  }

  // ─── Supabase provisioning ─────────────────────────────────────────────

  @ApiOperation({
    summary:
      'Connect the owner\'s own Supabase project (BYO). Credentials are ' +
      'verified against the live project before anything is stored — a bad ' +
      'key fails here rather than as a broken deploy later.',
  })
  @ApiResponse({ status: 200, description: 'Connected; returns status + warnings' })
  @ApiResponse({ status: 400, description: 'Credentials invalid or unreachable' })
  @Post(':id/supabase/connect')
  @HttpCode(HttpStatus.OK)
  async connectSupabase(
    @Param('id') id: string,
    @Body() dto: ConnectSupabaseDto,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ data: ConnectSupabaseResult }> {
    await this.projectAccessService.requireOwnerOrAdmin(user.userId, id);
    const data = await this.supabaseConnectionService.connect(
      id,
      user.userId,
      dto,
    );
    return { data };
  }

  @ApiOperation({
    summary:
      'Disconnect the project database. Clears stored credentials on the ' +
      "Jarvis side only — the owner's Supabase project is left untouched.",
  })
  @ApiResponse({ status: 200, description: 'Disconnected' })
  @Delete(':id/supabase/connect')
  @HttpCode(HttpStatus.OK)
  async disconnectSupabase(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ data: SupabaseConnectionStatus }> {
    await this.projectAccessService.requireOwnerOrAdmin(user.userId, id);
    const data = await this.supabaseConnectionService.disconnect(
      id,
      user.userId,
    );
    return { data };
  }

  @ApiOperation({
    summary:
      'Start Supabase provisioning for a project (mid-chat trigger). ' +
      'DEPRECATED — managed provisioning is off unless the operator sets ' +
      'SUPABASE_MANAGED_PROVISIONING=true. Use POST /supabase/connect instead.',
    deprecated: true,
  })
  @ApiResponse({ status: 202, description: 'Provisioning started; poll status' })
  @ApiResponse({
    status: 410,
    description: 'Managed provisioning disabled — connect your own Supabase',
  })
  @Post(':id/supabase/provision')
  @HttpCode(HttpStatus.ACCEPTED)
  async provisionSupabase(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ data: { status: string; ready: boolean; error?: string } }> {
    await this.projectAccessService.requireOwnerOrAdmin(user.userId, id);
    // Decision 07 — this route is dormant, not deleted. Answer 410 so the SPA
    // can route the user to the connect form instead of polling a status that
    // will never change.
    if (!isManagedProvisioningEnabled()) {
      throw new HttpException(
        {
          statusCode: HttpStatus.GONE,
          message: MANAGED_PROVISIONING_DISABLED_MESSAGE,
          error: 'supabase_managed_provisioning_disabled',
        },
        HttpStatus.GONE,
      );
    }
    // Non-blocking kickoff — provisioning outlives this request so an infra
    // proxy killing the connection can never strand the flow. The SPA polls
    // GET /supabase/status for the terminal state.
    const status = await this.projectsService.startSupabaseProvisioning(
      id,
      'mid-chat',
    );
    return { data: { status, ready: status === 'ready' } };
  }

  @ApiOperation({
    summary:
      'Get database status for a project: connection state, which migration ' +
      'transport is in use, and any SQL the owner still needs to run by hand.',
  })
  @ApiResponse({ status: 200, description: 'Current Supabase status' })
  @Get(':id/supabase/status')
  async getSupabaseStatus(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ data: SupabaseConnectionStatus }> {
    await this.projectAccessService.requireOwnerOrAdmin(user.userId, id);
    const data = await this.supabaseConnectionService.getStatus(
      id,
      user.userId,
    );
    return { data };
  }
}
