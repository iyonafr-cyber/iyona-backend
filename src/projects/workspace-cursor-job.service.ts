import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Cron } from '@nestjs/schedule';
import { Model } from 'mongoose';
import {
  WorkspaceCursorJob,
  WorkspaceCursorJobStatus,
} from './entities/workspace-cursor-job.entity';
import { UserProject } from './entities/user-project.entity';
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
import { CursorService } from 'src/cursor/cursor.service';
import {
  isSupabaseReadyForUse,
  resolveSupabaseMigrationMode,
} from './supabase-readiness';
import { CreditsService, Reservation } from 'src/credits/credits.service';
import { getCreditAction } from 'src/credits/constants/credit-actions';
import { randomUUID } from 'crypto';

export interface WorkspaceCursorJobSnapshot {
  id: string;
  status: WorkspaceCursorJobStatus;
  deploymentId?: string;
  mergedSha?: string;
  deployStatus?: string;
  errorMessage?: string;
  /** The agent's reply — the answer itself when status is ANSWERED. */
  agentMessage?: string;
}

const USER_SAFE_FAILED =
  "We couldn't apply your changes. Please try again or rephrase your request.";
const USER_SAFE_STALEMATE =
  'Your changes could not be merged automatically. Try a smaller edit or refresh and retry.';
const USER_SAFE_NO_CHANGES =
  'No changes were applied. Try describing the edit differently.';
const USER_SAFE_INFLIGHT =
  'Another publish is already running for this project. Wait for it to finish.';
const USER_SAFE_STALLED =
  'The previous edit stopped responding and was cancelled. Please try again.';

function envMs(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

/**
 * Staleness thresholds for presuming a job's in-process runner is dead (the
 * pipeline is fire-and-forget in memory, so a restart/crash leaves it frozen).
 * Thresholds are PER STATUS because a job's `updatedAt` only advances on a
 * status write — during the long, write-free phases it legitimately goes quiet:
 *   - QUEUED / RUNNING_AGENT: a single agent run is bounded (~15 min), so 30 min
 *     of silence means the runner is gone.
 *   - DEPLOYING: the deploy pipeline (cleanup + up to 3 repair agent rounds +
 *     Vercel waits) can legitimately run well over an hour with no job write, so
 *     we wait much longer before presuming death — otherwise we'd kill (and
 *     wrongly refund) a live build.
 * The reaper fails stale jobs and refunds credits; the blocking checks ignore
 * them so the project isn't locked out in the meantime.
 */
const AGENT_STALE_MS = envMs('WORKSPACE_JOB_AGENT_STALE_MS', 30 * 60 * 1000);
const DEPLOY_STALE_MS = envMs('WORKSPACE_JOB_DEPLOY_STALE_MS', 120 * 60 * 1000);

@Injectable()
export class WorkspaceCursorJobService {
  private readonly logger = new Logger(WorkspaceCursorJobService.name);

  constructor(
    @InjectModel(WorkspaceCursorJob.name)
    private readonly jobModel: Model<WorkspaceCursorJob>,
    @InjectModel(UserProject.name)
    private readonly projectModel: Model<UserProject>,
    @InjectModel(Revision.name)
    private readonly revisionModel: Model<Revision>,
    @InjectModel(Deployment.name)
    private readonly deploymentModel: Model<Deployment>,
    private readonly repoService: RepoService,
    private readonly revisionsService: RevisionsService,
    private readonly cursorService: CursorService,
    private readonly creditsService: CreditsService,
  ) {}

  /**
   * Returns an active non-terminal job for this project, if any.
   */
  async findBlockingJobForProject(
    projectId: string,
  ): Promise<WorkspaceCursorJob | null> {
    // Only jobs that are BOTH non-terminal AND fresh-for-their-status can block
    // a new one. A stale job (its runner died on a restart) must never lock the
    // project forever — it is treated as non-blocking here and cleaned up by
    // the reaper cron below.
    const now = Date.now();
    const agentCutoff = new Date(now - AGENT_STALE_MS);
    const deployCutoff = new Date(now - DEPLOY_STALE_MS);
    return this.jobModel
      .findOne({
        projectId,
        $or: [
          {
            status: {
              $in: [
                WorkspaceCursorJobStatus.QUEUED,
                WorkspaceCursorJobStatus.RUNNING_AGENT,
              ],
            },
            updatedAt: { $gte: agentCutoff },
          },
          {
            status: WorkspaceCursorJobStatus.DEPLOYING,
            updatedAt: { $gte: deployCutoff },
          },
        ],
      })
      .sort({ createdAt: -1 })
      .exec();
  }

  /**
   * Fail non-terminal jobs whose in-process runner is gone (server restarted or
   * crashed mid-build). Refunds their credit reservation via failJob. Runs
   * every 5 minutes. Without this a crash strands the job in RUNNING_AGENT /
   * DEPLOYING forever, and every future edit for that project is rejected 409.
   */
  @Cron('*/5 * * * *', { name: 'reap-stale-workspace-cursor-jobs' })
  async reapStaleJobs(): Promise<void> {
    const now = Date.now();
    const stale = await this.jobModel
      .find({
        $or: [
          {
            status: {
              $in: [
                WorkspaceCursorJobStatus.QUEUED,
                WorkspaceCursorJobStatus.RUNNING_AGENT,
              ],
            },
            updatedAt: { $lt: new Date(now - AGENT_STALE_MS) },
          },
          {
            status: WorkspaceCursorJobStatus.DEPLOYING,
            updatedAt: { $lt: new Date(now - DEPLOY_STALE_MS) },
          },
        ],
      })
      .select('_id')
      .lean()
      .exec();
    if (stale.length === 0) return;
    this.logger.warn(
      `[WorkspaceCursorJob] Reaping ${stale.length} stale job(s)`,
    );
    for (const row of stale) {
      // failJob flips status → FAILED and refunds the reservation exactly once.
      await this.failJob(String(row._id), USER_SAFE_STALLED).catch((err) => {
        this.logger.error(
          `[WorkspaceCursorJob] reap failed for ${String(row._id)}: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    }
  }

  async createQueuedJob(params: {
    projectId: string;
    userId: string;
    prompt: string;
    framework: string;
    /** Presigned S3 URLs for prompt attachments; Cursor fetches them. */
    promptImageUrls?: string[];
  }): Promise<{ jobId: string }> {
    // Reserve credits BEFORE launching the agent. An insufficient balance
    // throws InsufficientCreditsException here → HTTP 402, and no agent runs.
    // The reservation is persisted on the job so the processor (or the stale
    // job reaper after a crash) can commit it on success or refund on failure.
    const action = 'cursor_agent_update' as const;
    const reservation = await this.creditsService.reserve({
      userId: params.userId,
      action,
      amount: getCreditAction(action).minReserve,
      requestId: `cursor-update:${randomUUID()}`,
      projectId: params.projectId,
    });

    let doc;
    try {
      doc = await this.jobModel.create({
        projectId: params.projectId,
        userId: params.userId,
        prompt: params.prompt,
        promptImageUrls: params.promptImageUrls?.length
          ? params.promptImageUrls
          : undefined,
        framework: params.framework,
        status: WorkspaceCursorJobStatus.QUEUED,
        creditReservation: reservation as unknown as Record<string, unknown>,
        creditSettled: false,
      });
    } catch (err) {
      // Never strand a reservation if the job doc can't be created.
      await this.creditsService
        .refund(reservation, 'job_create_failed')
        .catch(() => undefined);
      throw err;
    }

    const jobId = String(doc._id);
    setImmediate(() => {
      void this.processJob(jobId).catch((err) => {
        this.logger.error(
          `[WorkspaceCursorJob] Unhandled processJob(${jobId}): ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    });
    return { jobId };
  }

  /**
   * Settle the credit reservation attached to a job exactly once. `charge` is
   * the credits to actually bill (the rest of the reservation is refunded);
   * pass 0 to refund the whole reservation (failed / no-op edits are free).
   * Guarded by an atomic `creditSettled` flip so a retry or the reaper racing
   * the processor can never double-charge or double-refund.
   */
  private async settleCredits(jobId: string, charge: number): Promise<void> {
    const claimed = await this.jobModel.findOneAndUpdate(
      { _id: jobId, creditSettled: { $ne: true } },
      { $set: { creditSettled: true } },
      { new: false },
    );
    const raw = claimed?.creditReservation;
    if (!raw) return; // no reservation attached, or already settled
    const reservation = raw as unknown as Reservation;
    try {
      if (charge > 0) {
        await this.creditsService.commit(reservation, charge);
      } else {
        await this.creditsService.refund(reservation, 'cursor_job_failed');
      }
    } catch (err) {
      this.logger.error(
        `[WorkspaceCursorJob] settleCredits(${jobId}) failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async getJobForUser(
    jobId: string,
    userId: string,
    projectId: string,
  ): Promise<WorkspaceCursorJobSnapshot> {
    const job = await this.jobModel.findById(jobId).exec();
    if (!job) {
      throw new NotFoundException('Job not found');
    }
    if (String(job.userId) !== userId) {
      throw new NotFoundException('Job not found');
    }
    if (String(job.projectId) !== projectId) {
      throw new NotFoundException('Job not found');
    }
    return this.toSnapshot(job);
  }

  private toSnapshot(job: WorkspaceCursorJob): WorkspaceCursorJobSnapshot {
    return {
      id: String(job._id),
      status: job.status,
      deploymentId: job.deploymentId ?? undefined,
      mergedSha: job.mergedSha ?? undefined,
      deployStatus: job.deployStatus ?? undefined,
      errorMessage: job.errorMessage ?? undefined,
      agentMessage: job.agentMessage ?? undefined,
    };
  }

  private async failJob(jobId: string, message: string): Promise<void> {
    await this.jobModel.updateOne(
      { _id: jobId },
      {
        $set: {
          status: WorkspaceCursorJobStatus.FAILED,
          errorMessage: message,
        },
      },
    );
    // Failed / blocked edits are not billed — refund the full reservation.
    await this.settleCredits(jobId, 0);
  }

  /** Terminal success for a question: the agent's reply, nothing to deploy. */
  private async answerJob(jobId: string, answer: string): Promise<void> {
    await this.jobModel.updateOne(
      { _id: jobId },
      {
        $set: {
          status: WorkspaceCursorJobStatus.ANSWERED,
          agentMessage: answer,
        },
      },
    );
    // A question consumed one agent run but no build/deploy — charge the
    // cheaper question rate and refund the difference from the update reserve.
    await this.settleCredits(
      jobId,
      getCreditAction('cursor_agent_question').minReserve,
    );
  }

  /**
   * Runs Cursor → merge → revision → deployPreview under project mutex.
   */
  async processJob(jobId: string): Promise<void> {
    const claimed = await this.jobModel.findOneAndUpdate(
      { _id: jobId, status: WorkspaceCursorJobStatus.QUEUED },
      { $set: { status: WorkspaceCursorJobStatus.RUNNING_AGENT } },
      { new: true },
    );
    if (!claimed) {
      this.logger.debug(
        `[WorkspaceCursorJob] Skip processJob(${jobId}) — not QUEUED`,
      );
      return;
    }

    const projectId = String(claimed.projectId);

    try {
      await this.repoService.runExclusive(projectId, async () => {
        const jobFresh = await this.jobModel.findById(jobId).exec();
        if (!jobFresh) {
          throw new Error('job_missing');
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
          .select('_id')
          .lean()
          .exec();

        if (inflight) {
          await this.failJob(jobId, USER_SAFE_INFLIGHT);
          return;
        }

        const project = await this.projectModel.findById(projectId).exec();
        if (!project?.jarvisGithub) {
          await this.failJob(jobId, USER_SAFE_FAILED);
          return;
        }

        const { owner, repo } = project.jarvisGithub;
        const prompt = jobFresh.prompt;

        // Enrich prompt with Supabase context when the project has a DB
        let enrichedPrompt = prompt;
        if (isSupabaseReadyForUse(project.supabase)) {
          // Decision 07 — the agent still emits __schema__.json either way.
          // What changes is who runs it: Iyona applies it automatically when
          // there is a DDL transport, and hands it to the owner as SQL when
          // there isn't. The agent must know, because in manual mode the
          // tables genuinely may not exist when the app first loads and the
          // generated code has to survive that instead of assuming success.
          const migrationMode = resolveSupabaseMigrationMode(project.supabase);
          const ownerRunsMigrations = migrationMode === 'manual';
          enrichedPrompt = [
            enrichedPrompt,
            '',
            '---',
            ownerRunsMigrations
              ? "SUPABASE DATABASE: This project is connected to the owner's own Supabase project."
              : 'SUPABASE DATABASE: This project has a managed Supabase database.',
            'When the request involves backend, data, "logic", persistence, or auth, use Supabase — not mock data or localStorage for those entities.',
            'Environment variables available at runtime: VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY.',
            'Use @supabase/supabase-js createClient for data access. Use supabase.auth for authentication.',
            'ROLES: a public.profiles table (id, email, role) with an is_admin() helper backs authorisation. Guard /admin routes on role === "admin", not just on being logged in. The admin account is created by the app owner from Iyona project settings — never build an admin signup or seed admin credentials in code.',
            'If you create or modify database tables, emit a __schema__.json file with the schema declaration.',
            ...(ownerRunsMigrations
              ? [
                  'SCHEMA IS APPLIED BY THE OWNER, NOT AUTOMATICALLY: Iyona cannot run DDL against this database. Your __schema__.json is rendered as SQL for the owner to run in the Supabase SQL editor, so a table you declare may not exist yet at runtime.',
                  'Therefore: handle query errors and empty results gracefully on every page that reads a table — render an empty state, never an unhandled crash or an infinite spinner. Do NOT fall back to mock arrays; an empty state is correct, fake data is not.',
                ]
              : []),
            'ALL surfaces must read and write the SAME table through the shared data module: if content added in admin does not appear on the public side, the public page is rendering a static mock array — replace it with the Supabase query and refetch after writes. Never fix a not-showing bug by hardcoding data.',
          ].join('\n');
        }

        // Enrich prompt with Stripe context when the project has payments set up
        if (
          project.paymentConfig?.enabled &&
          project.paymentConfig?.stripePublishableKey
        ) {
          enrichedPrompt = [
            enrichedPrompt,
            '',
            '---',
            'STRIPE PAYMENTS: This project has Stripe configured.',
            'When the request involves payments, checkout, subscriptions, or billing, use Stripe — not a mocked/fake payment step.',
            'Environment variable available at runtime: VITE_STRIPE_PUBLISHABLE_KEY.',
            'Use loadStripe from @stripe/stripe-js and mount Stripe Elements (or Checkout) for the payment flow.',
            'Never hardcode or expose a secret key in client code — only the publishable key is available to the frontend.',
          ].join('\n');
        }

        // Always remind the agent how owner-supplied config reaches the app.
        enrichedPrompt = [
          enrichedPrompt,
          '',
          '---',
          'USER-PROVIDED CONFIG: If this change needs any value only the owner can supply (API/secret keys, tokens, webhook URLs, social profile links, contact email), declare it as a KEY in the root `.env.example` — do NOT hardcode or fake it. The platform surfaces those keys in the Secrets panel for the owner to fill and injects them into every Vercel build. Values read in the browser must be prefixed VITE_ and read via import.meta.env; guard each usage so a missing key never breaks `npm run build`.',
        ].join('\n');

        const agentResult =
          await this.cursorService.runStandaloneUserPromptRound({
            projectId,
            owner,
            repo,
            userPrompt: enrichedPrompt,
            imageUrls: jobFresh.promptImageUrls,
          });

        if (agentResult.status === 'failed') {
          await this.failJob(jobId, USER_SAFE_FAILED);
          return;
        }
        if (agentResult.status === 'stalemate') {
          await this.failJob(jobId, USER_SAFE_STALEMATE);
          return;
        }
        if (
          agentResult.status === 'no_changes' ||
          agentResult.mergedSha == null ||
          agentResult.mergedSha === ''
        ) {
          // The agent changed nothing. If it replied, the message was a
          // question and that reply is the result — not a failure.
          const answer = agentResult.agentMessage?.trim();
          if (answer) {
            await this.answerJob(jobId, answer);
            this.logger.log(
              `[WorkspaceCursorJob] ${jobId} answered a question`,
            );
            return;
          }
          await this.failJob(jobId, USER_SAFE_NO_CHANGES);
          return;
        }

        const commitSha = agentResult.mergedSha;
        const fileCount = await this.repoService.getBlobCount(
          owner,
          repo,
          commitSha,
        );

        // Race-safe version allocation (double-submit / multi-replica).
        const revision =
          await this.revisionsService.createUploadedRevisionAtomic(projectId, {
            fileCount,
            initialCommitSha: commitSha,
            commitMessage: `cursor: ${prompt.slice(0, 200)}`,
            metadata: { cursorUserTask: prompt.slice(0, 4000) },
          });

        await this.projectModel.updateOne(
          { _id: projectId },
          {
            $set: {
              currentRevision: revision.version,
              latestRevisionId: revision._id,
            },
          },
        );

        await this.jobModel.updateOne(
          { _id: jobId },
          {
            $set: {
              status: WorkspaceCursorJobStatus.DEPLOYING,
              mergedSha: commitSha,
              revisionId: revision._id,
              ...(agentResult.agentMessage?.trim()
                ? { agentMessage: agentResult.agentMessage.trim() }
                : {}),
            },
          },
        );

        const result = await this.revisionsService.deployPreview(
          projectId,
          String(revision._id),
          jobFresh.framework ?? 'vite',
          { skipCursorCleanup: true },
        );

        await this.jobModel.updateOne(
          { _id: jobId },
          {
            $set: {
              status: WorkspaceCursorJobStatus.COMPLETED,
              deploymentId: result.deploymentId,
              deployStatus: result.status,
            },
          },
        );

        // A successful edit round (agent + merge + deploy) — charge the full
        // reserved amount for the update action.
        await this.settleCredits(
          jobId,
          getCreditAction('cursor_agent_update').minReserve,
        );

        this.logger.log(
          `[WorkspaceCursorJob] ${jobId} completed deploymentId=${result.deploymentId}`,
        );
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`[WorkspaceCursorJob] ${jobId} error: ${msg}`);
      await this.failJob(
        jobId,
        msg === 'job_missing' ? USER_SAFE_FAILED : USER_SAFE_FAILED,
      );
    }
  }
}
