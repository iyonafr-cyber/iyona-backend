import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Inject,
  Logger,
  Optional,
  forwardRef,
} from '@nestjs/common';
import { WebhooksService } from 'src/webhooks/webhooks.service';
import { InjectModel } from '@nestjs/mongoose';
import { Model, HydratedDocument, Types } from 'mongoose';
import { PatchService } from '../patch/patch.service';
import { ProjectErrorsService } from './project-errors.service';
import {
  UserProject,
  ProjectStage,
  StageStatus,
  TaskType,
  GenerationStatus,
  DeploymentStatus,
  ProjectStatus,
  SupabaseStatus,
} from './entities/user-project.entity';
import { Chat } from './entities/chat.entity';
import { ProjectMember } from './entities/project-member.entity';
import { WorkspaceCursorJob } from './entities/workspace-cursor-job.entity';
import { Revision } from '../revisions/entities/revision.entity';
import {
  Deployment,
  DeploymentStatus as VercelDeploymentStatus,
} from '../revisions/entities/deployment.entity';
import { UserProjectDto } from './dto/user-project-dto.dto';
import { CreateUserProjectDto } from './dto/create-user-project.dto';
import { UpdateUserProjectDto } from './dto/update-user-project.dto';
import { SaveQuestionnaireDto } from './dto/save-questionnaire.dto';
import { plainToInstance } from 'class-transformer';
import { logAndThrowError } from 'src/utils/error.utils';
import {
  normalizeUiLocale,
  resolveAppLocales,
  resolveConversationLocale,
} from '../common/conversation-locale';
import { DistributedLockService } from 'src/common/distributed-lock/distributed-lock.service';
import { Cron } from '@nestjs/schedule';
import type { IEncryptionService } from 'src/encryption/interface/encryption.interface.service';
import { S3Service } from 'src/s3/s3.service';
import { VercelService } from 'src/vercel/vercel.service';
import { stripVercelProtectionBypass } from 'src/vercel/vercel-deployment-url.util';
import { SupabaseService } from 'src/supabase/supabase.service';
import {
  ProjectAccessService,
  ProjectAccessRole,
} from './project-access.service';
import { ProjectMapperService } from './project-mapper.service';
import { SupabaseProvisioningService } from './supabase-provisioning.service';
import { resolveSqlTarget } from './supabase-sql-target';
import { resolveSupabaseMigrationMode } from './supabase-readiness';

/**
 * Days to keep soft-deleted projects around before the cron purges
 * them. Project owners can `restoreProject` within this window.
 */
const SOFT_DELETE_RETENTION_DAYS = 30;

@Injectable()
export class ProjectsService {
  private readonly logger = new Logger(ProjectsService.name);
  constructor(
    @InjectModel(UserProject.name)
    private userProjectModel: Model<UserProject>,
    @InjectModel(Chat.name)
    private chatModel: Model<Chat>,
    @InjectModel(Revision.name)
    private revisionModel: Model<Revision>,
    @InjectModel(Deployment.name)
    private deploymentModel: Model<Deployment>,
    @InjectModel(ProjectMember.name)
    private projectMemberModel: Model<ProjectMember>,
    @InjectModel(WorkspaceCursorJob.name)
    private workspaceCursorJobModel: Model<WorkspaceCursorJob>,
    @Inject('IEncryptionService')
    private encryptionService: IEncryptionService,
    @Inject(forwardRef(() => PatchService))
    private readonly patchService: PatchService,
    private readonly s3Service: S3Service,
    private readonly vercelService: VercelService,
    private readonly accessService: ProjectAccessService,
    private readonly mapper: ProjectMapperService,
    private readonly supabaseService: SupabaseService,
    private readonly supabaseProvisioning: SupabaseProvisioningService,
    private readonly projectErrorsService: ProjectErrorsService,
    // Per-project lock (cross-replica). Serializes patch / workflow / simple
    // update calls so a user double-clicking "Send" — or two replicas — can't
    // race two flows against the same project state. A distinct key namespace
    // from RepoService's repo lock so FSM writes don't contend with commits.
    private readonly lock: DistributedLockService,
    @Optional()
    @Inject(forwardRef(() => WebhooksService))
    private readonly webhooksService?: WebhooksService,
  ) {}

  /** Serialize project-state mutations under a cross-replica per-project lock. */
  private runProjectExclusive<T>(
    projectId: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    return this.lock.runExclusive(`project-fsm:${projectId}`, fn, {
      waitMs: 30_000,
    });
  }

  /**
   * Fire a webhook event for a project owner. Always fire-and-forget; we
   * never want a webhook misconfig to block the API path. Errors are logged
   * with structured fields so ops can detect delivery failures in log search.
   */
  private emitWebhook(
    userId: string,
    event:
      | 'project.created'
      | 'project.updated'
      | 'project.deleted'
      | 'project.restored'
      | 'project.deployed'
      | 'patch.applied'
      | 'build.succeeded'
      | 'build.failed',
    payload: Record<string, unknown>,
  ): void {
    if (!this.webhooksService) return;
    void this.webhooksService
      .enqueueForUser(userId, event, payload)
      .catch((err: unknown) => {
        this.logger.error(
          {
            event: 'webhook.enqueue_failed',
            webhookEvent: event,
            userId,
            projectId: payload['projectId'],
            error: err instanceof Error ? err.message : String(err),
          },
          `[Webhook] Failed to enqueue "${event}" for user ${userId}`,
        );
      });
  }

  /**
   * Load a project by id and confirm the caller owns it. Callers that need the
   * hydrated document use the returned value; callers that only need ownership
   * can ignore it.
   */
  async assertProjectOwner(
    projectId: string,
    userId: string,
  ): Promise<HydratedDocument<UserProject>> {
    // Owner gate lives on ProjectAccessService now (shared by the extracted
    // sub-services); kept here as a thin delegator because external modules
    // call `projectsService.assertProjectOwner`.
    return this.accessService.requireOwnedProject(userId, projectId);
  }

  /**
   * Same access as {@link getProjectById}: owner or project member with any role.
   * Use for read-only revision/preview APIs so collaborators match workspace loads.
   */
  async requireProjectViewer(projectId: string, userId: string): Promise<void> {
    await this.accessService.requireViewer(userId, projectId);
  }

  /**
   * Create a new user project. In full-repo mode, initial code generation
   * happens when the user's first AI prompt is processed — the project doc
   * is created here and the AI produces the complete repository on first gen.
   */
  async createProject(
    createUserProjectDto: CreateUserProjectDto,
    userId: string,
  ): Promise<UserProjectDto> {
    try {
      // Optional cap. Unset / 0 = unlimited — the old default of 50 blocked
      // waitlist and QA accounts. Set PROJECTS_PER_USER_QUOTA to re-enable.
      const quotaRaw = Number(process.env.PROJECTS_PER_USER_QUOTA);
      const quota =
        Number.isFinite(quotaRaw) && quotaRaw > 0 ? Math.floor(quotaRaw) : 0;
      if (quota > 0) {
        const owned = await this.userProjectModel
          .countDocuments({ userId, deletedAt: null })
          .exec();
        if (owned >= quota) {
          throw new BadRequestException(
            `Project quota reached (${owned}/${quota}). Delete an existing project or contact support to lift the limit.`,
          );
        }
      }

      const { withDatabase, uiLocale, conversationLocale, ...rest } =
        createUserProjectDto;

      const resolvedConversation =
        conversationLocale?.trim() ||
        resolveConversationLocale(
          rest.initialPrompt,
          normalizeUiLocale(uiLocale),
        );

      const appLocales = resolveAppLocales(resolvedConversation);

      const supabase = withDatabase
        ? {
            status: 'pending' as const,
          }
        : null;

      const project = await this.userProjectModel.create({
        ...rest,
        userId,
        supabase,
        conversationLocale: resolvedConversation,
        appLocales,
      });

      // Kick off Supabase provisioning OUT-OF-BAND so the HTTP request
      // returns immediately. Generation will await readiness via
      // ensureSupabaseReady() before the AI starts generating code.
      if (withDatabase) {
        void this.supabaseProvisioning.provisionSupabaseAsync(
          String(project._id),
          'initial',
        );
      } else if (rest.initialPrompt?.trim()) {
        // No explicit toggle — let the AI layer decide from the initial
        // prompt (same detector as mid-chat). Runs detached; the user
        // never has to know the toggle exists. Spec-build and deploy both
        // gate on supabase readiness, so a positive detection here means
        // the first build ships with a real database.
        void this.supabaseProvisioning.detectAndProvisionDatabase(
          String(project._id),
          rest.initialPrompt,
        );
      }

      this.emitWebhook(userId, 'project.created', {
        projectId: String(project._id),
        name: project.name,
      });

      return Object.assign(this.mapper.toProjectDto(project), {
        accessRole: 'owner' as ProjectAccessRole,
      });
    } catch (error) {
      throw logAndThrowError('error in createProject', error);
    }
  }

  /**
   * Ensure a project has a ready Supabase instance. If no Supabase
   * config exists or status is 'none', kicks off provisioning and waits.
   * If already 'ready', returns immediately. If 'pending'/'provisioning',
   * polls until ready (up to 3 min). Used as a wait-gate before code
   * generation when the AI needs a database.
   *
   * @param source - What triggered this: 'initial' (withDatabase toggle),
   *   'mid-chat' (AI detected need), or 'retry' (user retried failed).
   * @returns true if Supabase is ready, false if provisioning failed.
   */
  /**
   * Non-blocking provisioning kickoff. Starts Supabase provisioning in the
   * BACKGROUND (detached from the HTTP request) and returns the current status
   * immediately. The caller (SPA) then polls GET /supabase/status until 'ready'
   * or 'failed'.
   *
   * This exists because the blocking {@link ensureSupabaseReady} path ties a
   * 2-3 minute provisioning run to a single HTTP request — which infra proxies
   * routinely kill mid-flight, leaving the SPA to error out even though the DB
   * finished provisioning server-side (the "DB added but prompt never sent"
   * stuck state). Decoupling provisioning from the request removes that class
   * of failure entirely.
   *
   * Idempotent: if provisioning is already in-flight ('pending'/'provisioning')
   * or done ('ready'), it does NOT start a second run.
   */
  /**
   * State of the generated app's admin account, for Project settings → Admin.
   * `supported` is false when the project has no database — a mock-auth app
   * keeps its demo credentials in the generated source, so there is nothing
   * for us to create.
   */
  async getAppAdmin(
    projectId: string,
    userId: string,
  ): Promise<{
    supported: boolean;
    canManage: boolean;
    configured: boolean;
    email?: string;
    updatedAt?: Date;
    reason?: string;
  }> {
    const project = await this.assertProjectOwner(projectId, userId);
    const sb = project.supabase;

    if (!sb || sb.status !== 'ready' || !sb.projectRef) {
      return {
        supported: false,
        canManage: false,
        configured: false,
        reason:
          'This app has no database yet. Connect your Supabase project in Project settings → Database, then create an admin account here.',
      };
    }

    // Decision 07 — a BYO project can have a perfectly good database and still
    // be missing the two credentials this feature needs. That is a different
    // state from "no database": the tab stays visible and says which
    // credential to add, because both are one paste away in Database settings.
    const missing: string[] = [];
    if (!sb.serviceRoleKeyEnc) missing.push('service role key');
    if (resolveSupabaseMigrationMode(sb) === 'manual') {
      missing.push('database connection string');
    }
    if (missing.length > 0) {
      return {
        supported: true,
        canManage: false,
        configured: !!sb.adminEmail,
        email: sb.adminEmail,
        updatedAt: sb.adminUpdatedAt,
        reason:
          `Creating the admin account needs your ${missing.join(' and ')}. ` +
          'Add it in Project settings → Database.',
      };
    }

    return {
      supported: true,
      canManage: true,
      configured: !!sb.adminEmail,
      email: sb.adminEmail,
      updatedAt: sb.adminUpdatedAt,
    };
  }

  /**
   * Create (or reset the password of) the generated app's admin account.
   *
   * The generated app's admin panel has no signup — by design — so the account
   * has to be created out of band. We do it with the project's own
   * `service_role` key, which never leaves the backend. The password is passed
   * to Supabase Auth and NOT persisted by Iyona: only the email is stored, so
   * the settings panel can show who the admin is.
   */
  async setAppAdmin(
    projectId: string,
    userId: string,
    email: string,
    password: string,
  ): Promise<{ email: string; created: boolean; updatedAt: Date }> {
    const project = await this.assertProjectOwner(projectId, userId);
    const sb = project.supabase;

    if (!sb || sb.status !== 'ready' || !sb.projectRef) {
      throw new BadRequestException(
        'This project has no ready database, so an admin account cannot be created yet.',
      );
    }
    if (!sb.serviceRoleKeyEnc) {
      throw new BadRequestException(
        sb.source === 'byo'
          ? 'Add your Supabase service role key in Project settings → Database to create the app admin account.'
          : 'This project is missing its database service key. Re-provision the database and try again.',
      );
    }

    // The admin account needs BOTH transports: SQL to create `public.profiles`
    // and set the role, and the Auth Admin API to create the user. For BYO
    // projects the SQL half only exists if the owner supplied a connection
    // string — without it there is no way to write the role, and an auth user
    // with no admin row is just a regular signup.
    const resolved = resolveSqlTarget(
      sb,
      (cipher) => this.encryptionService.decrypt(cipher),
      projectId,
    );
    if (!resolved.target) {
      throw new BadRequestException(
        'Creating the app admin account needs database access. Add your Supabase database connection string in Project settings → Database.',
      );
    }

    let serviceRoleKey: string;
    try {
      serviceRoleKey = this.encryptionService.decrypt(sb.serviceRoleKeyEnc);
    } catch {
      throw new BadRequestException(
        'Could not read the database service key for this project.',
      );
    }

    // Order matters: the profiles table (and its new-user trigger) must exist
    // before the auth user is created, so the trigger writes their row.
    await this.supabaseService.ensureProfilesTable(resolved.target);

    const { id, created } = await this.supabaseService.upsertAuthUser({
      projectRef: sb.projectRef,
      serviceRoleKey,
      email,
      password,
    });

    await this.supabaseService.setProfileRole(
      resolved.target,
      id,
      email,
      'admin',
    );

    const updatedAt = new Date();
    await this.userProjectModel
      .updateOne(
        { _id: projectId },
        {
          $set: {
            'supabase.adminEmail': email,
            'supabase.adminUpdatedAt': updatedAt,
          },
        },
      )
      .exec();

    this.logger.log(
      `App admin ${created ? 'created' : 'password reset'} for project ${projectId}`,
    );

    return { email, created, updatedAt };
  }

  // Supabase provisioning moved to SupabaseProvisioningService. These thin
  // delegators remain because external callers (ProjectsController, the deploy
  // pipeline in RevisionsService) invoke them via ProjectsService.
  async startSupabaseProvisioning(
    projectId: string,
    source: 'initial' | 'mid-chat' | 'retry' = 'mid-chat',
  ): Promise<SupabaseStatus> {
    return this.supabaseProvisioning.startSupabaseProvisioning(
      projectId,
      source,
    );
  }

  async ensureSupabaseReady(
    projectId: string,
    source: 'initial' | 'mid-chat' | 'retry' = 'initial',
  ): Promise<boolean> {
    return this.supabaseProvisioning.ensureSupabaseReady(projectId, source);
  }

  /**
   * Get all projects with pagination
   */
  async getAllProjects(
    userId: string,
    page: number = 1,
    limit: number = 20,
  ): Promise<{
    data: UserProjectDto[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    hasMore: boolean;
  }> {
    try {
      const skip = (page - 1) * limit;

      // Get total count of projects for the user (excluding soft-deleted)
      const total = await this.userProjectModel
        .countDocuments({ userId: userId, deletedAt: null })
        .exec();

      // Get paginated projects, sorted by createdAt descending (newest first)
      const projects = await this.userProjectModel
        .find({ userId: userId, deletedAt: null })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .exec();

      const totalPages = Math.ceil(total / limit);
      const hasMore = page < totalPages;

      return {
        data: projects.map((project) => this.mapper.toProjectDto(project)),
        total,
        page,
        limit,
        totalPages,
        hasMore,
      };
    } catch (error) {
      throw logAndThrowError('error in getAllProjects', error);
    }
  }

  /**
   * Get a project by ID
   */
  async getProjectById(
    id: string,
    userId: string,
  ): Promise<UserProjectDto & { accessRole: ProjectAccessRole }> {
    try {
      if (!Types.ObjectId.isValid(id)) {
        throw new NotFoundException(`Project with ID ${id} not found`);
      }
      const accessRole = await this.accessService.requireViewer(userId, id);
      const project = await this.userProjectModel.findById(id).exec();
      if (!project || project.deletedAt) {
        throw new NotFoundException(`Project with ID ${id} not found`);
      }
      const dto = this.mapper.toProjectDto(project, accessRole);
      return Object.assign(dto, { accessRole });
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof ForbiddenException
      ) {
        throw error;
      }
      throw logAndThrowError('error in getProjectById', error);
    }
  }

  /**
   * Update a project by ID
   */
  async updateProject(
    id: string,
    userId: string,
    updateData: UpdateUserProjectDto,
  ): Promise<UserProjectDto> {
    try {
      await this.assertProjectOwner(id, userId);
      const project = await this.userProjectModel
        .findByIdAndUpdate(id, { $set: updateData }, { new: true })
        .exec();
      if (!project) {
        throw new NotFoundException(`Project with ID ${id} not found`);
      }
      this.emitWebhook(userId, 'project.updated', {
        projectId: id,
        changedFields: Object.keys(updateData ?? {}),
      });
      return this.mapper.toProjectDto(project);
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof ForbiddenException
      ) {
        throw error;
      }
      throw logAndThrowError('error in updateProject', error);
    }
  }

  /**
   * Delete a project by ID and cascade delete all related data.
   * Order:
   *   1. Best-effort remove Vercel aliases + deployments for this project
   *   2. Best-effort delete the S3 prefix for this project
   *   3. Delete Mongo deployments, revisions, chats
   *   4. Delete the project itself
   *
   * External resource cleanup is best-effort (logged, not thrown) so that a
   * transient Vercel/S3 failure never leaves an orphan project row around.
   */
  async deleteProject(id: string, userId: string): Promise<void> {
    try {
      await this.assertProjectOwner(id, userId);

      // Soft-delete: stamp `deletedAt` and stop here. Hard cleanup
      // (Vercel / Supabase / S3 / Mongo cascades) is deferred to
      // `purgeExpiredSoftDeletes` so the user has a 30-day window to
      // restore the project via `restoreProject`. The list/get
      // queries already filter by `deletedAt: null` so the project
      // disappears from the UI immediately.
      const now = new Date();
      const updated = await this.userProjectModel
        .findOneAndUpdate(
          { _id: id, deletedAt: null },
          { $set: { deletedAt: now } },
          { new: true },
        )
        .exec();
      if (!updated) {
        throw new NotFoundException('Project not found');
      }

      this.emitWebhook(userId, 'project.deleted', {
        projectId: id,
        softDelete: true,
        deletedAt: now.toISOString(),
        purgeAfterDays: SOFT_DELETE_RETENTION_DAYS,
      });
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof ForbiddenException
      ) {
        throw error;
      }
      throw logAndThrowError('error in deleteProject', error);
    }
  }

  /**
   * Restore a previously soft-deleted project, as long as it is still
   * within the retention window. Owner-only.
   */
  async restoreProject(id: string, userId: string): Promise<UserProjectDto> {
    try {
      const project = await this.userProjectModel.findById(id).exec();
      if (!project) {
        throw new NotFoundException('Project not found');
      }
      if (String(project.userId) !== String(userId)) {
        throw new ForbiddenException(
          'Only the project owner can restore a deleted project',
        );
      }
      if (!project.deletedAt) {
        throw new BadRequestException('Project is not in a deleted state');
      }
      const cutoff = new Date(
        Date.now() - SOFT_DELETE_RETENTION_DAYS * 86_400_000,
      );
      if (project.deletedAt < cutoff) {
        throw new BadRequestException(
          `Restore window of ${SOFT_DELETE_RETENTION_DAYS} days has passed`,
        );
      }
      project.deletedAt = null;
      await project.save();
      this.emitWebhook(userId, 'project.restored', { projectId: id });
      return this.mapper.toProjectDto(project);
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof ForbiddenException ||
        error instanceof BadRequestException
      ) {
        throw error;
      }
      throw logAndThrowError('error in restoreProject', error);
    }
  }

  /**
   * List the caller's soft-deleted projects that are still inside the
   * retention window. Without this endpoint the 30-day restore feature
   * is purely theoretical — the user has no way to discover what they
   * can restore (the main project list filters `deletedAt: null`).
   * The returned shape mirrors `getAllProjects` so the frontend can
   * reuse the same row component for the "Trash" view.
   */
  async listDeletedProjects(
    userId: string,
  ): Promise<{ data: UserProjectDto[]; total: number }> {
    try {
      const cutoff = new Date(
        Date.now() - SOFT_DELETE_RETENTION_DAYS * 86_400_000,
      );
      const projects = await this.userProjectModel
        .find({
          userId,
          deletedAt: { $ne: null, $gte: cutoff },
        })
        .sort({ deletedAt: -1 })
        .exec();
      return {
        data: projects.map((project) => this.mapper.toProjectDto(project)),
        total: projects.length,
      };
    } catch (error) {
      throw logAndThrowError('error in listDeletedProjects', error);
    }
  }

  /**
   * Hard-purge soft-deleted projects whose retention window has
   * expired. Reuses the original cascade logic (Vercel, Supabase, S3,
   * Mongo) so we don't drift from `deleteProject`'s old behavior.
   * Runs daily at 03:15 UTC via `@Cron`.
   */
  @Cron('15 3 * * *', { name: 'purge-expired-soft-deleted-projects' })
  async purgeExpiredSoftDeletes(): Promise<void> {
    // Add a 1-hour grace period beyond the nominal 30-day window so that a
    // project deleted just before midnight always has its full 30 days before
    // the daily 03:15 UTC cron can purge it — preventing an edge case where
    // "deleted on day 30 at 03:16 UTC" gets purged on the next cron run.
    const GRACE_MS = 60 * 60 * 1000; // 1 hour
    const cutoff = new Date(
      Date.now() - SOFT_DELETE_RETENTION_DAYS * 86_400_000 - GRACE_MS,
    );
    const expired = await this.userProjectModel
      .find({ deletedAt: { $ne: null, $lt: cutoff } })
      .select('_id userId supabase jarvisGithub customDomain')
      .lean()
      .exec();

    if (expired.length === 0) return;
    this.logger.log(
      `Purging ${expired.length} soft-deleted projects older than ${SOFT_DELETE_RETENTION_DAYS}d`,
    );

    const describeErr = (err: unknown): string =>
      err instanceof Error ? err.message : 'unknown error';

    for (const proj of expired) {
      const id = String(proj._id);
      try {
        const deployments = await this.deploymentModel
          .find({ projectId: id })
          .select('vercelDeploymentId alias')
          .lean()
          .exec();
        const seenAliases = new Set<string>();
        for (const dep of deployments) {
          if (dep.alias && !seenAliases.has(dep.alias)) {
            seenAliases.add(dep.alias);
            await this.vercelService
              .removeAlias(dep.alias)
              .catch(() => undefined);
          }
          const vid = dep.vercelDeploymentId;
          if (vid?.startsWith('dpl_')) {
            await this.vercelService
              .deleteDeployment(vid)
              .catch(() => undefined);
          }
        }

        // Custom domain: detach from the Vercel project so it is freed for
        // reuse (and the sparse-unique `customDomain` Mongo row is released
        // when the project doc is deleted below).
        // Bucket B (compat): must match the deploy-time name; existing projects
        // are `jarvis-<id>` on Vercel. Keep the prefix (see vercel.service.ts).
        const vercelProjectName = `jarvis-${id}`;
        const customDomain = (proj as { customDomain?: string }).customDomain;
        if (customDomain) {
          await this.vercelService
            .removeDomainFromProject(vercelProjectName, customDomain)
            .catch((err: unknown) =>
              this.logger.warn(
                `Failed to remove custom domain ${customDomain} for project ${id}: ${describeErr(err)}`,
              ),
            );
        }

        // Delete the whole Vercel project (`jarvis-<id>`) so we don't leak dead
        // projects + their remaining domains/deployments on the Vercel account.
        await this.vercelService
          .deleteVercelProject(vercelProjectName)
          .catch((err: unknown) =>
            this.logger.warn(
              `Failed to delete Vercel project ${vercelProjectName} for project ${id}: ${describeErr(err)}`,
            ),
          );

        const supabaseRef = proj.supabase?.projectRef;
        if (supabaseRef) {
          await this.supabaseService
            .deleteProject(supabaseRef)
            .catch((err: unknown) =>
              this.logger.warn(
                `Failed to delete Supabase project ${supabaseRef} for project ${id}: ${describeErr(err)}`,
              ),
            );
        }

        await this.s3Service.deleteProjectFolder(id).catch((err: unknown) => {
          this.logger.warn(
            `Failed to delete S3 folder for project ${id}: ${describeErr(err)}`,
          );
        });

        await this.deploymentModel.deleteMany({ projectId: id }).exec();
        await this.revisionModel.deleteMany({ projectId: id }).exec();
        await this.chatModel.deleteMany({ projectId: id }).exec();
        await this.projectMemberModel
          .deleteMany({ projectId: new Types.ObjectId(id) })
          .exec();
        // Cascade the async build/edit job records so they don't accumulate.
        await this.workspaceCursorJobModel
          .deleteMany({ projectId: new Types.ObjectId(id) })
          .exec()
          .catch((err: unknown) =>
            this.logger.warn(
              `Failed to delete workspace cursor jobs for ${id}: ${describeErr(err)}`,
            ),
          );
        // Cascade the patch module's component schemas + version snapshots.
        await this.patchService
          .purgeProjectData(id)
          .catch((err: unknown) =>
            this.logger.warn(
              `Failed to purge patch data for ${id}: ${describeErr(err)}`,
            ),
          );
        await this.projectErrorsService
          .deleteAllForProject(id)
          .catch((err: unknown) =>
            this.logger.warn(
              `Failed to delete project errors for ${id}: ${describeErr(err)}`,
            ),
          );
        // GitHub repos are intentionally left intact for audit/recovery.
        // Log the orphaned repo so ops can track them.
        const github = (proj as any).jarvisGithub;
        if (github?.owner && github?.repo) {
          this.logger.log(
            `Orphaned GitHub repo for purged project ${id}: ${github.owner}/${github.repo} (left intact per policy)`,
          );
        }

        await this.userProjectModel.findByIdAndDelete(id).exec();
        this.logger.log(`Purged soft-deleted project ${id}`);
      } catch (err) {
        this.logger.error(
          `Failed to purge soft-deleted project ${id}: ${describeErr(err)}`,
        );
      }
    }
  }

  // ==================== WORKFLOW STATE MACHINE METHODS ====================

  /**
   * Transition project to a new stage. Internal helper - callers should have
   * already verified ownership via `assertProjectOwner`.
   */
  async transitionToStage(
    projectId: string,
    userId: string,
    newStage: ProjectStage,
    newStatus: StageStatus = StageStatus.IN_PROGRESS,
  ): Promise<UserProjectDto> {
    try {
      const project = await this.assertProjectOwner(projectId, userId);

      if (
        project.stage !== newStage &&
        !project.completedStages.includes(project.stage)
      ) {
        project.completedStages.push(project.stage);
      }

      project.stage = newStage;
      project.stageStatus = newStatus;

      project.locked = ![
        ProjectStage.CONVERSATION,
        ProjectStage.QUESTIONNAIRE_READY,
        ProjectStage.DEPLOYED,
      ].includes(newStage);

      await project.save();
      return this.mapper.toProjectDto(project);
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof ForbiddenException
      ) {
        throw error;
      }
      throw logAndThrowError('error in transitionToStage', error);
    }
  }

  /**
   * Update task heartbeat
   */
  async updateHeartbeat(
    projectId: string,
    userId: string,
  ): Promise<UserProjectDto> {
    try {
      const project = await this.assertProjectOwner(projectId, userId);

      if (project.currentTask) {
        project.currentTask.lastHeartbeat = new Date();
        await project.save();
      }

      return this.mapper.toProjectDto(project);
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof ForbiddenException
      ) {
        throw error;
      }
      throw logAndThrowError('error in updateHeartbeat', error);
    }
  }

  /**
   * Check for stalled projects and mark them as failed.
   *
   * IMPORTANT: code-generation and deployment run SERVER-side (Cursor agent +
   * Vercel pipeline) — a stale BROWSER heartbeat proves nothing about them
   * (background tabs throttle timers past 60s, laptops sleep, users reload).
   * For the deployment stage we therefore judge liveness by the actual
   * deployment record and SELF-HEAL: if Vercel already succeeded, the project
   * is finalized to DEPLOYED instead of being (or staying) marked failed.
   * The heartbeat is only a generous last-resort backstop.
   */
  async checkAndRecoverStalledProject(
    projectId: string,
    userId: string,
  ): Promise<UserProjectDto> {
    try {
      const project = await this.assertProjectOwner(projectId, userId);

      // ── Deployment stage: consult the deployment record, not the browser ──
      if (
        project.stage === ProjectStage.DEPLOYMENT &&
        (project.stageStatus === StageStatus.IN_PROGRESS ||
          project.stageStatus === StageStatus.FAILED)
      ) {
        const latest = await this.deploymentModel
          .findOne({ projectId: new Types.ObjectId(projectId) })
          .sort({ createdAt: -1 })
          .exec();

        if (latest) {
          // Deployment actually succeeded → finalize to DEPLOYED. This also
          // repairs projects a previous stale-heartbeat sweep mis-marked as
          // failed after the deploy had already gone through.
          if (
            latest.status === VercelDeploymentStatus.READY &&
            latest.previewUrl
          ) {
            const pollingId =
              (typeof latest.metadata?.clientPollingDeploymentId === 'string' &&
                latest.metadata.clientPollingDeploymentId) ||
              latest.vercelDeploymentId ||
              String(latest._id);
            await this.finalizeDeploymentWorkflowFromBackend(
              projectId,
              String(project.userId),
              pollingId,
              latest.previewUrl,
            );
            const fresh = await this.userProjectModel
              .findById(projectId)
              .exec();
            return this.mapper.toProjectDto(fresh ?? project);
          }

          // Pipeline still alive server-side → never fail on heartbeat, and
          // recover a premature FAILED mark.
          const pipelineActive = [
            VercelDeploymentStatus.QUEUED,
            VercelDeploymentStatus.BUILDING,
            VercelDeploymentStatus.REPAIRING,
          ].includes(latest.status);
          if (pipelineActive) {
            let dirty = false;
            if (project.stageStatus === StageStatus.FAILED) {
              project.stageStatus = StageStatus.IN_PROGRESS;
              dirty = true;
            }
            if (project.currentTask) {
              project.currentTask.lastHeartbeat = new Date();
              dirty = true;
            }
            if (dirty) await project.save();
            return this.mapper.toProjectDto(project);
          }

          // Terminal deployment failure → the stage genuinely failed.
          if (
            project.stageStatus === StageStatus.IN_PROGRESS &&
            [
              VercelDeploymentStatus.ERROR,
              VercelDeploymentStatus.CANCELED,
              VercelDeploymentStatus.FAILED,
            ].includes(latest.status)
          ) {
            project.stageStatus = StageStatus.FAILED;
            await project.save();
            return this.mapper.toProjectDto(project);
          }
        }
        // No deployment record → fall through to the heartbeat backstop.
      }

      if (
        project.stageStatus === StageStatus.IN_PROGRESS &&
        project.currentTask?.lastHeartbeat
      ) {
        const now = new Date();
        const lastHeartbeat = new Date(project.currentTask.lastHeartbeat);
        const timeSinceHeartbeat =
          (now.getTime() - lastHeartbeat.getTime()) / 1000;

        // Server-driven stages get a long leash (the browser heartbeat is not
        // their liveness signal); client-driven stages get enough slack to
        // survive background-tab timer throttling.
        const serverDriven =
          project.stage === ProjectStage.CODE_GENERATION ||
          project.stage === ProjectStage.DEPLOYMENT;
        const staleAfterSeconds = serverDriven ? 15 * 60 : 3 * 60;

        if (timeSinceHeartbeat > staleAfterSeconds) {
          project.stageStatus = StageStatus.FAILED;
        }
      }

      await project.save();
      return this.mapper.toProjectDto(project);
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof ForbiddenException
      ) {
        throw error;
      }
      throw logAndThrowError('error in checkAndRecoverStalledProject', error);
    }
  }

  /**
   * Start questionnaire stage
   */
  async startQuestionnaire(
    projectId: string,
    userId: string,
  ): Promise<UserProjectDto> {
    try {
      return await this.transitionToStage(
        projectId,
        userId,
        ProjectStage.QUESTIONNAIRE,
        StageStatus.IN_PROGRESS,
      );
    } catch (error) {
      throw logAndThrowError('error in startQuestionnaire', error);
    }
  }

  /**
   * Persist generated questionnaire JSON and mark the project ready for the
   * user to answer (resume if they navigate away before submitting).
   */
  async saveQuestionnaire(
    projectId: string,
    userId: string,
    dto: SaveQuestionnaireDto,
  ): Promise<UserProjectDto> {
    try {
      const project = await this.assertProjectOwner(projectId, userId);

      project.questionnaire = {
        questions: dto.questions,
        ...(dto.estimatedTime != null && { estimatedTime: dto.estimatedTime }),
      };
      project.stage = ProjectStage.QUESTIONNAIRE_READY;
      project.stageStatus = StageStatus.IDLE;
      project.locked = false;

      await project.save();
      return this.mapper.toProjectDto(project);
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof ForbiddenException
      ) {
        throw error;
      }
      throw logAndThrowError('error in saveQuestionnaire', error);
    }
  }

  /**
   * Complete questionnaire and automatically start execution plan
   */
  async completeQuestionnaire(
    projectId: string,
    userId: string,
  ): Promise<UserProjectDto> {
    try {
      const project = await this.assertProjectOwner(projectId, userId);

      // Mark questionnaire as completed
      if (!project.completedStages.includes(ProjectStage.QUESTIONNAIRE)) {
        project.completedStages.push(ProjectStage.QUESTIONNAIRE);
      }

      // Transition to execution-plan stage
      project.stage = ProjectStage.EXECUTION_PLAN;
      project.stageStatus = StageStatus.IN_PROGRESS;
      project.locked = true;

      // Start execution-plan task
      const now = new Date();
      project.currentTask = {
        type: TaskType.EXECUTION_PLAN,
        startedAt: now,
        lastHeartbeat: now,
        retryCount: 0,
      };

      await project.save();
      return this.mapper.toProjectDto(project);
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw logAndThrowError('error in completeQuestionnaire', error);
    }
  }

  /**
   * Complete execution plan and automatically start code generation
   */
  async completeExecutionPlan(
    projectId: string,
    userId: string,
  ): Promise<UserProjectDto> {
    try {
      const project = await this.assertProjectOwner(projectId, userId);

      // Mark execution-plan as completed
      if (!project.completedStages.includes(ProjectStage.EXECUTION_PLAN)) {
        project.completedStages.push(ProjectStage.EXECUTION_PLAN);
      }

      // Transition to code-generation stage
      project.stage = ProjectStage.CODE_GENERATION;
      project.stageStatus = StageStatus.IN_PROGRESS;
      project.locked = true;

      // Start code-generation task
      const now = new Date();
      project.currentTask = {
        type: TaskType.CODE_GENERATION,
        startedAt: now,
        lastHeartbeat: now,
        retryCount: 0,
      };

      // Set generation status to in_progress
      project.generation.status = GenerationStatus.IN_PROGRESS;

      await project.save();
      return this.mapper.toProjectDto(project);
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof ForbiddenException
      ) {
        throw error;
      }
      throw logAndThrowError('error in completeExecutionPlan', error);
    }
  }

  /**
   * Complete code generation and automatically start deployment.
   *
   * Wrapped in the per-project mutex so concurrent calls (e.g. network
   * retries, duplicate frontend dispatches) don't race the generation
   * status and version counter, which previously caused the last write
   * to silently overwrite an earlier completed generation.
   */
  async completeCodeGeneration(
    projectId: string,
    userId: string,
    generatedFiles: string[],
  ): Promise<UserProjectDto> {
    return this.runProjectExclusive(projectId, async () => {
      try {
        const project = await this.assertProjectOwner(projectId, userId);

        // Idempotency guard: if generation was already marked completed by a
        // prior call (retry storm), return the current state without touching it.
        if (project.generation.status === GenerationStatus.COMPLETED) {
          this.logger.warn(
            `[C3] completeCodeGeneration called on already-completed project ${projectId} — returning current state`,
          );
          return this.mapper.toProjectDto(project);
        }

        // Mark code-generation as completed
        if (!project.completedStages.includes(ProjectStage.CODE_GENERATION)) {
          project.completedStages.push(ProjectStage.CODE_GENERATION);
        }

        // Update generation status
        project.generation.status = GenerationStatus.COMPLETED;
        project.generation.generatedFiles = generatedFiles;
        project.generation.completedAt = new Date();

        // Transition to deployment stage
        project.stage = ProjectStage.DEPLOYMENT;
        project.stageStatus = StageStatus.IN_PROGRESS;
        project.locked = true;

        // Start deployment task
        const now = new Date();
        project.currentTask = {
          type: TaskType.DEPLOYMENT,
          startedAt: now,
          lastHeartbeat: now,
          retryCount: 0,
        };

        // Set deployment status to in_progress
        project.deployment.status = DeploymentStatus.IN_PROGRESS;

        await project.save();
        return this.mapper.toProjectDto(project);
      } catch (error) {
        if (
          error instanceof NotFoundException ||
          error instanceof ForbiddenException
        ) {
          throw error;
        }
        throw logAndThrowError('error in completeCodeGeneration', error);
      }
    });
  }

  /**
   * Backend-only: mark workflow + nested deployment fields after Vercel reports
   * READY (same persistence as `completeDeployment`, without client verification).
   * Used by `RevisionsService` so projects reach DEPLOYED even if the SPA closes.
   */
  async finalizeDeploymentWorkflowFromBackend(
    projectId: string,
    ownerUserId: string,
    deploymentId: string,
    previewUrl: string,
  ): Promise<void> {
    if (!deploymentId || typeof deploymentId !== 'string') {
      throw new BadRequestException('deploymentId is required');
    }
    if (!previewUrl || typeof previewUrl !== 'string') {
      throw new BadRequestException('previewUrl is required');
    }
    if (!/^https?:\/\//i.test(previewUrl)) {
      throw new BadRequestException('previewUrl must be an http(s) URL');
    }

    const verifiedPreviewUrl = stripVercelProtectionBypass(previewUrl);

    const prior = await this.userProjectModel
      .findOne({
        _id: new Types.ObjectId(projectId),
        userId: new Types.ObjectId(ownerUserId),
        deletedAt: null,
      })
      .select('stage deployment.deploymentId')
      .lean()
      .exec();

    const alreadyFinalized =
      prior?.stage === ProjectStage.DEPLOYED &&
      prior.deployment?.deploymentId === deploymentId;

    const updated = await this.userProjectModel.findOneAndUpdate(
      {
        _id: new Types.ObjectId(projectId),
        userId: new Types.ObjectId(ownerUserId),
        deletedAt: null,
      },
      {
        $set: {
          status: ProjectStatus.DEPLOYED,
          'deployment.status': DeploymentStatus.COMPLETED,
          'deployment.deploymentId': deploymentId,
          'deployment.previewUrl': verifiedPreviewUrl,
          'deployment.completedAt': new Date(),
          previewUrl: verifiedPreviewUrl,
          stage: ProjectStage.DEPLOYED,
          stageStatus: StageStatus.COMPLETED,
          locked: false,
        },
        $addToSet: { completedStages: ProjectStage.DEPLOYMENT },
        $unset: { currentTask: '' },
      },
      { new: true },
    );

    if (!updated) {
      this.logger.warn(
        `finalizeDeploymentWorkflowFromBackend: project ${projectId} not found or owner mismatch — skipping workflow finalize`,
      );
      return;
    }

    if (!alreadyFinalized) {
      this.emitWebhook(ownerUserId, 'project.deployed', {
        projectId,
        previewUrl: verifiedPreviewUrl ?? previewUrl,
        deploymentId,
      });
    }
  }

  /**
   * Complete deployment and mark project as deployed
   */
  async completeDeployment(
    projectId: string,
    userId: string,
    deploymentId: string,
    previewUrl: string,
  ): Promise<UserProjectDto> {
    try {
      // Ownership check up front so we fail fast on unauthorized callers.
      await this.assertProjectOwner(projectId, userId);

      if (!deploymentId || typeof deploymentId !== 'string') {
        throw new BadRequestException('deploymentId is required');
      }
      if (!previewUrl || typeof previewUrl !== 'string') {
        throw new BadRequestException('previewUrl is required');
      }
      // Minimal sanity check — reject anything that isn't an http(s) URL so we
      // don't persist `javascript:` / data URIs into deployment records and
      // render them as iframes in the preview panel.
      if (!/^https?:\/\//i.test(previewUrl)) {
        throw new BadRequestException('previewUrl must be an http(s) URL');
      }

      // Verify the deployment with Vercel so a malicious client can't flip a
      // project to DEPLOYED by POSTing arbitrary IDs/URLs. We accept the
      // canonical URL from Vercel over whatever the client supplied, but keep
      // the client URL as a fallback when Vercel returns a relative `url`
      // field (which the frontend has already normalised to https://).
      let verifiedPreviewUrl = previewUrl;
      try {
        const status =
          await this.vercelService.getDeploymentStatus(deploymentId);
        if (status.readyState !== 'READY') {
          throw new BadRequestException(
            `Deployment ${deploymentId} is not ready (state=${status.readyState})`,
          );
        }
        if (status.url) {
          verifiedPreviewUrl = status.url.startsWith('http')
            ? status.url
            : `https://${status.url}`;
        }
      } catch (verifyError) {
        if (verifyError instanceof BadRequestException) throw verifyError;
        // Vercel API outages should not block deploy finalization — the
        // client already waited for READY before calling us. Log and fall
        // through using the client-supplied previewUrl.
        this.logger.warn(
          `Could not verify deployment ${deploymentId} with Vercel; trusting client payload: ${(verifyError as Error).message}`,
        );
      }

      verifiedPreviewUrl = stripVercelProtectionBypass(verifiedPreviewUrl);

      const existingForFinalize = await this.userProjectModel
        .findOne({
          _id: new Types.ObjectId(projectId),
          userId: new Types.ObjectId(userId),
          deletedAt: null,
        })
        .select('stage deployment.deploymentId')
        .exec();

      if (
        existingForFinalize?.stage === ProjectStage.DEPLOYED &&
        existingForFinalize.deployment?.deploymentId === deploymentId
      ) {
        const fresh = await this.userProjectModel.findById(projectId).exec();
        if (!fresh) {
          throw new NotFoundException(`Project with ID ${projectId} not found`);
        }
        return this.mapper.toProjectDto(fresh);
      }

      await this.finalizeDeploymentWorkflowFromBackend(
        projectId,
        userId,
        deploymentId,
        verifiedPreviewUrl ?? previewUrl,
      );

      const updated = await this.userProjectModel.findById(projectId).exec();
      if (!updated) {
        throw new NotFoundException(`Project with ID ${projectId} not found`);
      }

      return this.mapper.toProjectDto(updated);
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof ForbiddenException ||
        error instanceof BadRequestException
      ) {
        throw error;
      }
      throw logAndThrowError('error in completeDeployment', error);
    }
  }

  /**
   * Mark a stage as failed
   */
  async failStage(
    projectId: string,
    userId: string,
    errorMessage?: string,
  ): Promise<UserProjectDto> {
    try {
      const project = await this.assertProjectOwner(projectId, userId);

      project.stageStatus = StageStatus.FAILED;
      project.currentTask = undefined;
      project.locked = true; // Keep locked until user retries

      if (errorMessage && project.metadata) {
        project.metadata.lastError = errorMessage;
      }

      await project.save();
      return this.mapper.toProjectDto(project);
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof ForbiddenException
      ) {
        throw error;
      }
      throw logAndThrowError('error in failStage', error);
    }
  }

  /**
   * Retry a failed stage
   */
  async retryStage(projectId: string, userId: string): Promise<UserProjectDto> {
    try {
      const project = await this.assertProjectOwner(projectId, userId);

      if (project.stageStatus !== StageStatus.FAILED) {
        throw new BadRequestException(
          'Can only retry failed stages. Current status: ' +
            project.stageStatus,
        );
      }

      // Reset status to in_progress and unlock the project; `failStage` sets
      // `locked = true` so the user can't kick off new work mid-failure, but
      // once they explicitly retry we must clear the flag or chat/input stays
      // disabled forever.
      project.stageStatus = StageStatus.IN_PROGRESS;
      project.locked = false;

      // Start appropriate task based on current stage
      const now = new Date();
      let taskType: TaskType;

      switch (project.stage) {
        case ProjectStage.EXECUTION_PLAN:
          taskType = TaskType.EXECUTION_PLAN;
          break;
        case ProjectStage.CODE_GENERATION:
          taskType = TaskType.CODE_GENERATION;
          // Reset generation status if it failed
          if (project.generation.status === GenerationStatus.FAILED) {
            project.generation.status = GenerationStatus.IN_PROGRESS;
          }
          break;
        case ProjectStage.DEPLOYMENT:
          taskType = TaskType.DEPLOYMENT;
          // Reset deployment status if it failed
          if (project.deployment.status === DeploymentStatus.FAILED) {
            project.deployment.status = DeploymentStatus.IN_PROGRESS;
          }
          break;
        default:
          throw new BadRequestException(`Cannot retry stage: ${project.stage}`);
      }

      project.currentTask = {
        type: taskType,
        startedAt: now,
        lastHeartbeat: now,
        retryCount: (project.currentTask?.retryCount || 0) + 1,
      };

      await project.save();
      return this.mapper.toProjectDto(project);
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof ForbiddenException ||
        error instanceof BadRequestException
      ) {
        throw error;
      }
      throw logAndThrowError('error in retryStage', error);
    }
  }

  /**
   * Check if chat input should be enabled for a project
   */
  async isChatEnabled(projectId: string, userId: string): Promise<boolean> {
    try {
      const project = await this.assertProjectOwner(projectId, userId);

      return (
        project.stage === ProjectStage.CONVERSATION ||
        project.stage === ProjectStage.DEPLOYED
      );
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof ForbiddenException
      ) {
        throw error;
      }
      throw logAndThrowError('error in isChatEnabled', error);
    }
  }
}
