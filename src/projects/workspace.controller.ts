import {
  Controller,
  Get,
  Put,
  Post,
  Param,
  Body,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  ConflictException,
  NotFoundException,
  BadRequestException,
  HttpException,
} from '@nestjs/common';
import {
  ArrayMaxSize,
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { AuthGuard } from 'src/auth/guards/auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorator/roles.decorator';
import { UserRole } from 'src/user/roles/roles.enum';
import {
  CurrentUser,
  CurrentUserPayload,
} from 'src/auth/decorator/current-user.decorator';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { UserProject } from './entities/user-project.entity';
import { S3Service } from '../s3/s3.service';
import {
  PROMPT_IMAGE_MAX_BYTES,
  PROMPT_IMAGE_MAX_COUNT,
  parsePromptImageDataUrl,
} from './prompt-images';
import {
  Revision,
  RevisionStatus,
} from 'src/revisions/entities/revision.entity';
import {
  Deployment,
  DeploymentStatus,
} from 'src/revisions/entities/deployment.entity';
import { RepoService } from 'src/repo/repo.service';
import { RevisionsService } from 'src/revisions/revisions.service';
import { WorkspaceCursorJobService } from './workspace-cursor-job.service';
import {
  CursorService,
  type CodebaseAnswerStatus,
} from 'src/cursor/cursor.service';
import { CreditsGuard } from 'src/credits/guards/credits.guard';
import { CreditAction } from 'src/credits/decorator/credit-action.decorator';
import { CreditsService } from 'src/credits/credits.service';
import { getCreditAction } from 'src/credits/constants/credit-actions';
import { randomUUID } from 'crypto';
import { DatabaseDetectService } from './database-detect.service';
import { ProjectAccessService } from './project-access.service';
import {
  isSupabaseReadyForUse,
  supabaseLifecycleStatus,
} from './supabase-readiness';
import {
  isManagedProvisioningEnabled,
  MANAGED_PROVISIONING_DISABLED_MESSAGE,
} from 'src/supabase/managed-provisioning.flag';

// ── DTOs ──────────────────────────────────────────────────────────────────────

class FileChange {
  @IsString()
  path: string;

  @IsOptional()
  @IsString()
  content?: string;

  @IsOptional()
  deleted?: boolean;
}

class SaveFilesDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FileChange)
  changes: FileChange[];

  @IsOptional()
  @IsString()
  message?: string;
}

class DeployWorkspaceDto {
  @IsOptional()
  @IsString()
  /** User intent for this deploy — becomes the incremental Cursor cleanup prompt (rev v2+). */
  userTask?: string;
}

class CursorUpdateDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(12000)
  prompt: string;

  /**
   * Images attached to the prompt, as `data:image/...;base64,...` URLs — the
   * same ones the SPA already built for the chat thumbnail. Uploaded to S3
   * here and handed to Cursor as URLs; the bytes never reach the job row.
   *
   * Note this field has to exist for images to arrive at all: the global
   * ValidationPipe runs with `whitelist: true`, so an undeclared property is
   * stripped from the body without an error.
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(PROMPT_IMAGE_MAX_COUNT)
  @IsString({ each: true })
  images?: string[];
}

class AskWorkspaceDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  question: string;
}

// ── Controller ────────────────────────────────────────────────────────────────

@UseGuards(AuthGuard, RolesGuard)
@Roles(UserRole.USER)
@Controller('projects/:projectId/workspace')
export class WorkspaceController {
  constructor(
    @InjectModel(UserProject.name)
    private readonly projectModel: Model<UserProject>,
    @InjectModel(Revision.name)
    private readonly revisionModel: Model<Revision>,
    @InjectModel(Deployment.name)
    private readonly deploymentModel: Model<Deployment>,
    private readonly repoService: RepoService,
    private readonly revisionsService: RevisionsService,
    private readonly workspaceCursorJobService: WorkspaceCursorJobService,
    private readonly databaseDetect: DatabaseDetectService,
    private readonly cursorService: CursorService,
    private readonly creditsService: CreditsService,
    private readonly accessService: ProjectAccessService,
    private readonly s3Service: S3Service,
  ) {}

  /**
   * Decode prompt images and park them in S3, returning the URLs Cursor will
   * fetch. Rejects loudly: a silently dropped attachment looks to the user
   * exactly like an agent that ignored their screenshot.
   */
  private async uploadPromptImages(
    projectId: string,
    dataUrls: string[],
  ): Promise<string[]> {
    if (dataUrls.length === 0) return [];
    if (dataUrls.length > PROMPT_IMAGE_MAX_COUNT) {
      throw new BadRequestException(
        `At most ${PROMPT_IMAGE_MAX_COUNT} images can be attached to a prompt`,
      );
    }

    const parsed = dataUrls.map((dataUrl, index) => {
      const image = parsePromptImageDataUrl(dataUrl);
      if (!image) {
        throw new BadRequestException(
          `Attachment ${index + 1} is not a supported image (PNG, JPEG, GIF or WebP)`,
        );
      }
      if (image.buffer.byteLength > PROMPT_IMAGE_MAX_BYTES) {
        throw new BadRequestException(
          `Attachment ${index + 1} is larger than ${Math.floor(PROMPT_IMAGE_MAX_BYTES / (1024 * 1024))} MB`,
        );
      }
      return image;
    });

    return Promise.all(
      parsed.map((image) =>
        this.s3Service.uploadPromptImage(
          projectId,
          image.buffer,
          image.mimeType,
          image.extension,
        ),
      ),
    );
  }

  // ── GET /projects/:projectId/workspace/files ─────────────────────────────

  @Get('files')
  async getFiles(
    @Param('projectId') projectId: string,
    @CurrentUser() user: CurrentUserPayload,
    @Query('sha') sha?: string,
  ): Promise<{ data: Record<string, string> }> {
    const project = await this.requireProject(projectId, user.userId);
    const { owner, repo } = project.jarvisGithub;
    const commitSha =
      sha ?? (await this.repoService.getBranchHead(owner, repo));
    const files = await this.repoService.readTreeAtSha(owner, repo, commitSha);
    return { data: files };
  }

  // ── PUT /projects/:projectId/workspace/files ─────────────────────────────

  @Put('files')
  @HttpCode(HttpStatus.OK)
  async saveFiles(
    @Param('projectId') projectId: string,
    @Body() dto: SaveFilesDto,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ data: { sha: string } }> {
    const project = await this.requireProject(projectId, user.userId);
    const { owner, repo } = project.jarvisGithub;

    // Reject saves while a Cursor round is in flight
    const inFlightDeploy = await this.deploymentModel
      .findOne({
        projectId,
        status: {
          $in: [
            DeploymentStatus.QUEUED,
            DeploymentStatus.BUILDING,
            DeploymentStatus.REPAIRING,
          ],
        },
      })
      .select('_id status')
      .lean()
      .exec();

    if (inFlightDeploy) {
      throw new ConflictException(
        'A deploy is in progress. Wait for it to finish before saving.',
      );
    }

    // Delta commit — only changed/deleted files (no full tree read needed).
    // Short lock wait: this is a synchronous HTTP request, so if the project is
    // genuinely busy we surface a 409 fast rather than hanging the socket.
    return this.repoService.runExclusive(
      projectId,
      async () => {
        const message =
          dto.message?.trim() ||
          `workspace: ${dto.changes.length} file(s) changed by user`;

        const { sha } = await this.repoService.commitDelta(
          owner,
          repo,
          dto.changes,
          message,
        );

        return { data: { sha } };
      },
      { waitMs: 15_000 },
    );
  }

  // ── POST /projects/:projectId/workspace/deploy ───────────────────────────

  @Post('deploy')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseGuards(CreditsGuard)
  @CreditAction('workspace_deploy')
  async deploy(
    @Param('projectId') projectId: string,
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: DeployWorkspaceDto,
    @Query('framework') framework = 'vite',
  ): Promise<{ data: { deploymentId: string; status: string } }> {
    const project = await this.requireProject(projectId, user.userId);
    const { owner, repo } = project.jarvisGithub;

    // Reject if there's already a deploy in flight
    const inFlight = await this.deploymentModel
      .findOne({
        projectId,
        status: {
          $in: [
            DeploymentStatus.QUEUED,
            DeploymentStatus.BUILDING,
            DeploymentStatus.REPAIRING,
          ],
        },
      })
      .select('vercelDeploymentId metadata')
      .lean()
      .exec();

    if (inFlight) {
      // Already building — return the in-flight id WITHOUT charging again.
      return {
        data: {
          deploymentId: this.resolvePollingDeploymentId(inFlight),
          status: 'QUEUED',
        },
      };
    }

    // Meter the deploy: it runs a Cursor cleanup round plus up to N repair
    // rounds. Reserve up front so an insufficient balance is a clean 402, and
    // refund if we fail before the pipeline is actually launched.
    const reservation = await this.creditsService.reserve({
      userId: user.userId,
      action: 'workspace_deploy',
      amount: getCreditAction('workspace_deploy').minReserve,
      requestId: `workspace-deploy:${randomUUID()}`,
      projectId,
    });

    try {
      // Get HEAD SHA and blob count (no content download needed)
      const commitSha = await this.repoService.getBranchHead(owner, repo);
      const fileCount = await this.repoService.getBlobCount(
        owner,
        repo,
        commitSha,
      );

      const task = dto.userTask?.trim();
      const taskMeta =
        task && task.length > 0
          ? { cursorUserTask: task.slice(0, 4000) }
          : undefined;

      // Create a new Revision pointing at the current SHA. Race-safe version
      // allocation (double-submit / multi-replica) via RevisionsService.
      const revision = await this.revisionsService.createUploadedRevisionAtomic(
        projectId,
        {
          fileCount,
          initialCommitSha: commitSha,
          commitMessage: task
            ? `deploy: ${task.slice(0, 200)}`
            : `workspace deploy`,
          ...(taskMeta ? { metadata: taskMeta } : {}),
        },
      );

      // Update project
      await this.projectModel.updateOne(
        { _id: projectId },
        {
          $set: {
            currentRevision: revision.version,
            latestRevisionId: revision._id,
          },
        },
      );

      // Kick off the Cursor → Vercel pipeline
      const result = await this.revisionsService.deployPreview(
        projectId,
        String(revision._id),
        framework,
      );

      // Pipeline launched — bill the deploy round.
      await this.creditsService
        .commit(reservation, getCreditAction('workspace_deploy').minReserve)
        .catch(() => undefined);

      return {
        data: { deploymentId: result.deploymentId, status: result.status },
      };
    } catch (err) {
      // Never charge for a deploy we failed to start.
      await this.creditsService
        .refund(reservation, 'workspace_deploy_launch_failed')
        .catch(() => undefined);
      throw err;
    }
  }

  /**
   * Ask the Cursor Cloud Agent a read-only question about the project's code
   * and return its answer. Synchronous: the request is held until the agent run
   * terminates (bounded by CURSOR_ASK_TIMEOUT_MS), because the answer — not the
   * agent session — is the deliverable.
   */
  @Post('ask')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CreditsGuard)
  @CreditAction('cursor_agent_question')
  async ask(
    @Param('projectId') projectId: string,
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: AskWorkspaceDto,
  ): Promise<{
    data: {
      status: CodebaseAnswerStatus;
      answer: string;
      agentId?: string;
      runId?: string;
      durationMs?: number;
    };
  }> {
    const question = dto.question.trim();
    if (!question.length) {
      throw new BadRequestException('question is required');
    }

    const project = await this.requireProject(projectId, user.userId);
    const { owner, repo } = project.jarvisGithub;

    // Meter the read-only agent run: reserve, then commit only when the agent
    // actually answered. A timeout or failure is not billed.
    const reservation = await this.creditsService.reserve({
      userId: user.userId,
      action: 'cursor_agent_question',
      amount: getCreditAction('cursor_agent_question').minReserve,
      requestId: `cursor-ask:${randomUUID()}`,
      projectId,
    });

    let result: Awaited<ReturnType<CursorService['askCodebaseQuestion']>>;
    try {
      result = await this.cursorService.askCodebaseQuestion({
        projectId,
        owner,
        repo,
        question,
      });
    } catch (err) {
      await this.creditsService
        .refund(reservation, 'cursor_ask_error')
        .catch(() => undefined);
      throw err;
    }

    if (result.status === 'answered') {
      await this.creditsService
        .commit(
          reservation,
          getCreditAction('cursor_agent_question').minReserve,
        )
        .catch(() => undefined);
    } else {
      await this.creditsService
        .refund(reservation, `cursor_ask_${result.status}`)
        .catch(() => undefined);
    }

    return {
      data: {
        status: result.status,
        answer: result.answer,
        agentId: result.agentId,
        runId: result.runId,
        durationMs: result.durationMs,
      },
    };
  }

  @Get('cursor-update/jobs/:jobId')
  async getCursorUpdateJob(
    @Param('projectId') projectId: string,
    @Param('jobId') jobId: string,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{
    data: {
      id: string;
      status: string;
      deploymentId?: string;
      mergedSha?: string;
      deployStatus?: string;
      errorMessage?: string;
      agentMessage?: string;
    };
  }> {
    await this.requireProject(projectId, user.userId);
    const snap = await this.workspaceCursorJobService.getJobForUser(
      jobId,
      user.userId,
      projectId,
    );
    return {
      data: {
        id: snap.id,
        status: snap.status,
        deploymentId: snap.deploymentId,
        mergedSha: snap.mergedSha,
        deployStatus: snap.deployStatus,
        errorMessage: snap.errorMessage,
        agentMessage: snap.agentMessage,
      },
    };
  }

  /**
   * Queue an async code update (Git-backed pipeline), then publish preview.
   * Returns immediately with jobId — poll GET cursor-update/jobs/:jobId until
   * deploymentId is set or status is FAILED.
   */
  @Post('cursor-update')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseGuards(CreditsGuard)
  @CreditAction('cursor_agent_update')
  async cursorUpdate(
    @Param('projectId') projectId: string,
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: CursorUpdateDto,
    @Query('framework') framework = 'vite',
  ): Promise<{
    data: {
      jobId?: string;
      status: string;
      deploymentId?: string;
      mergedSha?: string;
      /** When true, the prompt needs a database this project doesn't have. */
      needsDatabaseProvisioning?: boolean;
      /** Current Supabase lifecycle when needsDatabaseProvisioning is true. */
      databaseStatus?: string;
      /** Set when databaseStatus is failed — safe to show in the SPA. */
      databaseError?: string;
      /**
       * What the SPA should do about it (decision 07). `connect` means show
       * the "Connect your Supabase" form — Iyona will NOT provision a
       * database, so polling for one is a dead wait. `provision` is the legacy
       * path, only returned when managed provisioning is switched on.
       */
      databaseAction?: 'connect' | 'provision';
    };
  }> {
    const prompt = dto.prompt.trim();
    if (!prompt.length) {
      throw new BadRequestException('prompt is required');
    }

    await this.requireProject(projectId, user.userId);

    // ── Mid-chat database detection (AI-based) ─────────────────────
    // The ONLY gate in front of the Cursor agent. Everything else — bug
    // reports, tweaks, even questions — goes straight to the agent, which can
    // actually inspect and fix the code. (An earlier LLM intent-classifier
    // that answered "questions" in chat was removed: it misread bug reports
    // like "cars are not showing on the user side" as questions and replied
    // with generic advice instead of fixing anything.)
    const project = await this.projectModel
      .findById(projectId)
      .select('supabase name initialPrompt')
      .lean();
    const sb = project?.supabase;

    // Only gate when the prompt needs a DB AND we don't already have one.
    // "Please make it work on supabase" is a fix request once credentials
    // exist — it must reach the Cursor agent, not re-run provisioning.
    if (!isSupabaseReadyForUse(sb)) {
      // Pass what the app IS: the classifier judges an edit request far better
      // in context ("add reviews" means something different for a static
      // brochure site than for a marketplace).
      const needsDb = await this.databaseDetect.promptRequiresDatabase(prompt, {
        name: project?.name,
        idea: project?.initialPrompt,
      });
      if (needsDb) {
        const databaseStatus = supabaseLifecycleStatus(sb);
        // Decision 07 — tell the SPA which affordance to show. Without this it
        // falls back to the provisioning spinner and polls a status that will
        // never leave 'none', because nothing is provisioning anything.
        const databaseAction = isManagedProvisioningEnabled()
          ? 'provision'
          : 'connect';
        return {
          data: {
            status: 'NEEDS_DATABASE',
            needsDatabaseProvisioning: true,
            databaseStatus,
            databaseAction,
            ...(databaseAction === 'connect'
              ? { databaseError: MANAGED_PROVISIONING_DISABLED_MESSAGE }
              : databaseStatus === 'failed' && sb?.provisioningError
                ? { databaseError: sb.provisioningError }
                : {}),
          },
        };
      }
    }

    const blocking =
      await this.workspaceCursorJobService.findBlockingJobForProject(projectId);
    if (blocking) {
      throw new HttpException(
        {
          statusCode: HttpStatus.CONFLICT,
          message: 'workspace_update_in_progress',
          jobId: String(blocking._id),
        },
        HttpStatus.CONFLICT,
      );
    }

    const inflight = await this.deploymentModel
      .findOne({
        projectId,
        status: {
          $in: [
            DeploymentStatus.QUEUED,
            DeploymentStatus.BUILDING,
            DeploymentStatus.REPAIRING,
          ],
        },
      })
      .select('vercelDeploymentId metadata')
      .lean()
      .exec();

    if (inflight) {
      return {
        data: {
          status: 'QUEUED',
          deploymentId: this.resolvePollingDeploymentId(inflight),
        },
      };
    }

    // Uploaded before the job is queued: a failed upload should surface as a
    // 400/500 on this request, not as a job that silently runs without the
    // screenshot the user attached.
    const promptImageUrls = await this.uploadPromptImages(
      projectId,
      dto.images ?? [],
    );

    const { jobId } = await this.workspaceCursorJobService.createQueuedJob({
      projectId,
      userId: user.userId,
      prompt,
      framework,
      promptImageUrls,
    });

    return {
      data: {
        jobId,
        status: 'QUEUED',
      },
    };
  }

  // ── Legacy inline cursor-update (removed) replaced by async job + poll ───

  /** Client polls deployment progress by this id (may live on metadata or Vercel field). */
  private resolvePollingDeploymentId(row: {
    vercelDeploymentId?: string | null;
    metadata?: Record<string, unknown> | null;
  }): string {
    const raw = row.metadata?.['clientPollingDeploymentId'];
    const fromMeta = typeof raw === 'string' ? raw : '';
    const id =
      fromMeta.length > 0 ? fromMeta : (row.vercelDeploymentId ?? undefined);
    if (typeof id !== 'string' || id.length === 0) {
      throw new ConflictException(
        'A deployment is in progress but the polling id is missing. Retry shortly.',
      );
    }
    return id;
  }

  private async requireProject(
    projectId: string,
    userId: string,
  ): Promise<
    UserProject & { jarvisGithub: NonNullable<UserProject['jarvisGithub']> }
  > {
    // Owner OR project admin — the workspace is exactly the surface (edit,
    // deploy, chat) the admin role is meant to grant. Read-only 'user'
    // collaborators get a 403, consistent with the rest of the API (the old
    // owner-only check returned 404 and locked invited admins out entirely).
    await this.accessService.requireOwnerOrAdmin(userId, projectId);

    const project = await this.projectModel.findById(projectId).exec();
    if (!project || project.deletedAt) {
      throw new NotFoundException(`Project ${projectId} not found`);
    }
    if (!project.jarvisGithub) {
      throw new BadRequestException(
        `Project ${projectId} has no GitHub-backed source. Generate the project first.`,
      );
    }
    return project as UserProject & {
      jarvisGithub: NonNullable<UserProject['jarvisGithub']>;
    };
  }
}
