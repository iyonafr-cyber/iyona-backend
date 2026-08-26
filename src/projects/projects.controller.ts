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
  ForbiddenException,
} from '@nestjs/common';
import { ProjectsService } from './projects.service';
import { ProjectPatchService } from './project-patch.service';
import { PublicProjectsService } from './public-projects.service';
import { ProjectSettingsService } from './project-settings.service';
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
import { ExtractSchemaDto, RollbackComponentDto } from './dto/patch.dto';
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
  LogProjectErrorDto,
  ProjectErrorDto,
  UpdateProjectErrorDto,
} from './dto/project-error.dto';
import { ProjectErrorStatus } from './entities/project-error.entity';

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

  // Static path declared BEFORE `:id` so NestJS doesn't try to load
  // a project literally named "deleted".
  @Get('deleted')
  async getDeletedProjects(
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ data: UserProjectDto[]; total: number }> {
    return this.projectsService.listDeletedProjects(user.userId);
  }

  @Get(':id')
  async getProjectById(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ data: UserProjectDto }> {
    const project = await this.projectsService.getProjectById(id, user.userId);
    return { data: project };
  }

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

  @Delete(':id')
  async deleteProject(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ message: string }> {
    await this.projectsService.deleteProject(id, user.userId);
    return { message: 'Project deleted successfully' };
  }

  @Post(':id/restore')
  async restoreProject(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ data: UserProjectDto }> {
    const project = await this.projectsService.restoreProject(id, user.userId);
    return { data: project };
  }

  // ==================== WORKFLOW ENDPOINTS ====================

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

  @Post(':id/workflow/heartbeat')
  async updateHeartbeat(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ data: UserProjectDto }> {
    const project = await this.projectsService.updateHeartbeat(id, user.userId);
    return { data: project };
  }

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

  @Post(':id/workflow/retry-stage')
  async retryStage(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ data: UserProjectDto }> {
    const project = await this.projectsService.retryStage(id, user.userId);
    return { data: project };
  }

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

  @Get(':id/workflow/chat-enabled')
  async isChatEnabled(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ enabled: boolean }> {
    const enabled = await this.projectsService.isChatEnabled(id, user.userId);
    return { enabled };
  }

  // ==================== PAYMENT CONFIGURATION ENDPOINTS ====================

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

  // PR-1.8: built-app Stripe is off by default and enabled globally via the
  // BUILT_APP_STRIPE_ENABLED env flag. Reads (`GET payment-config`)
  // intentionally stay open so previously-configured projects don't break in
  // the UI; mutations require the feature to be enabled.
  @Put(':id/payment-config')
  async updatePaymentConfig(
    @Param('id') id: string,
    @Body() updatePaymentConfigDto: UpdatePaymentConfigDto,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ data: UserProjectDto }> {
    if (process.env.BUILT_APP_STRIPE_ENABLED !== 'true') {
      throw new ForbiddenException('Built-app Stripe is not enabled.');
    }
    const project = await this.projectSettingsService.updatePaymentConfig(
      id,
      user.userId,
      updatePaymentConfigDto,
    );
    return { data: project };
  }

  @Post(':id/payment-config/validate')
  async validateStripeConnection(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ valid: boolean; message: string }> {
    if (process.env.BUILT_APP_STRIPE_ENABLED !== 'true') {
      throw new ForbiddenException('Built-app Stripe is not enabled.');
    }
    return this.projectSettingsService.validateStripeConnection(
      id,
      user.userId,
    );
  }

  // ==================== PROJECT BUILD SECRETS (.env.example) ====================

  @Get(':id/secrets')
  async getProjectSecrets(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ data: ProjectSecretsResponseDto }> {
    const data = await this.projectSettingsService.getProjectSecrets(
      id,
      user.userId,
    );
    return { data };
  }

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

  @Get(':id/components')
  async getComponents(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<any> {
    return this.projectPatchService.getComponents(id, user.userId);
  }

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

  @Get(':id/snapshots')
  async getSnapshots(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<any> {
    return this.projectPatchService.getSnapshots(id, user.userId);
  }

  @Post(':id/snapshots/:version/rollback')
  async rollbackProject(
    @Param('id') id: string,
    @Param('version') version: number,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<any> {
    return this.projectPatchService.rollbackProject(id, user.userId, version);
  }

  @Get(':id/snapshots/:version/diff')
  async diffSnapshot(
    @Param('id') id: string,
    @Param('version') version: number,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<any> {
    return this.projectPatchService.diffSnapshot(id, user.userId, version);
  }

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
