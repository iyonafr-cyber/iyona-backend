import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Cron } from '@nestjs/schedule';
import { Model } from 'mongoose';
import {
  SpecBuildJob,
  SpecBuildJobStatus,
} from './entities/spec-build-job.entity';
import { SpecBuildService } from './spec-build.service';
import { RepoService } from '../repo/repo.service';
import type { PaletteOverrides } from '../ui-kit/ui-kit.constants';
import { palettesFromDesignSystem } from '../ui-kit/palette-generator';
import type { QuestionPaletteColors } from '../ai/ai.service';

export interface SpecBuildJobSnapshot {
  id: string;
  status: SpecBuildJobStatus;
  buildStatus?: string;
  mergedSha?: string;
  prUrl?: string;
  revisionId?: string;
  deploymentId?: string;
  deployStatus?: string;
  loadingFiles?: string[];
  estimate?: {
    buildSeconds: number;
    tokens: number;
    fileCount: number;
  };
  errorMessage?: string;
}

const USER_SAFE_FAILED =
  'We could not build your app. Please try again or adjust your project idea.';
const USER_SAFE_GITHUB =
  'GitHub is not configured correctly on the server (invalid or expired token). Ask an admin to update GITHUB_PAT.';
const USER_SAFE_CURSOR_GITHUB =
  'Cursor cannot access the project GitHub repo. Install the Cursor GitHub App on the org that owns repos (GITHUB_ORG) in Cursor → Integrations, or point GITHUB_ORG at an org Cursor already covers.';
const USER_SAFE_INFLIGHT =
  'Another build is already running for this project. Wait for it to finish.';
const USER_SAFE_STALLED =
  'The build stopped responding and was cancelled. Please try again.';

function envMs(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

/**
 * Per-status staleness thresholds for presuming a spec-build job's in-process
 * runner is dead (the pipeline is fire-and-forget in memory). `updatedAt` only
 * advances on a status write, so during the long write-free phases a live job
 * goes quiet:
 *   - QUEUED / RUNNING: the full first build (multi-file agent run) is bounded
 *     but larger than a chat edit — 45 min of silence means the runner is gone.
 *   - DEPLOYING: deploy pipeline with repair rounds + Vercel waits can run well
 *     over an hour, so we wait much longer before presuming death.
 */
const RUNNING_STALE_MS = envMs('SPEC_BUILD_RUNNING_STALE_MS', 45 * 60 * 1000);
const DEPLOY_STALE_MS = envMs('SPEC_BUILD_DEPLOY_STALE_MS', 120 * 60 * 1000);

function palettesFromThemeAnswer(
  answers: Record<string, unknown>,
): PaletteOverrides | undefined {
  const theme = answers.theme;
  if (!theme || typeof theme !== 'object' || Array.isArray(theme)) {
    return undefined;
  }
  const colors = (theme as { colors?: QuestionPaletteColors }).colors;
  if (!colors) return undefined;
  return palettesFromDesignSystem(colors);
}

/**
 * Read the design-style id the user picked in the questionnaire. Accepts it
 * either at the top level (`answers.designStyle`) or nested on the theme
 * answer (`answers.theme.style`). Returns undefined for Auto / missing, which
 * the resolver treats as "use the deterministic per-project pick".
 */
function styleIdFromAnswers(
  answers: Record<string, unknown>,
): string | undefined {
  const top = answers.designStyle;
  if (typeof top === 'string' && top.trim()) return top.trim();
  const theme = answers.theme;
  if (theme && typeof theme === 'object' && !Array.isArray(theme)) {
    const nested = (theme as { style?: unknown }).style;
    if (typeof nested === 'string' && nested.trim()) return nested.trim();
  }
  return undefined;
}

@Injectable()
export class SpecBuildJobService {
  private readonly logger = new Logger(SpecBuildJobService.name);

  constructor(
    @InjectModel(SpecBuildJob.name)
    private readonly jobModel: Model<SpecBuildJob>,
    private readonly specBuildService: SpecBuildService,
    private readonly repoService: RepoService,
  ) {}

  async findBlockingJobForProject(
    projectId: string,
  ): Promise<SpecBuildJob | null> {
    // A stale job (runner died on restart) must not block new builds forever —
    // exclude anything not fresh-for-its-status; the reaper cleans those up.
    const now = Date.now();
    return this.jobModel
      .findOne({
        projectId,
        $or: [
          {
            status: {
              $in: [SpecBuildJobStatus.QUEUED, SpecBuildJobStatus.RUNNING],
            },
            updatedAt: { $gte: new Date(now - RUNNING_STALE_MS) },
          },
          {
            status: SpecBuildJobStatus.DEPLOYING,
            updatedAt: { $gte: new Date(now - DEPLOY_STALE_MS) },
          },
        ],
      })
      .sort({ createdAt: -1 })
      .exec();
  }

  /**
   * Fail spec-build jobs whose in-process runner is gone (restart/crash mid
   * build). Runs every 5 minutes. Without it a crash strands the job in
   * RUNNING/DEPLOYING and blocks all future builds for that project with 409.
   */
  @Cron('*/5 * * * *', { name: 'reap-stale-spec-build-jobs' })
  async reapStaleJobs(): Promise<void> {
    const now = Date.now();
    const result = await this.jobModel.updateMany(
      {
        $or: [
          {
            status: {
              $in: [SpecBuildJobStatus.QUEUED, SpecBuildJobStatus.RUNNING],
            },
            updatedAt: { $lt: new Date(now - RUNNING_STALE_MS) },
          },
          {
            status: SpecBuildJobStatus.DEPLOYING,
            updatedAt: { $lt: new Date(now - DEPLOY_STALE_MS) },
          },
        ],
      },
      {
        $set: {
          status: SpecBuildJobStatus.FAILED,
          errorMessage: USER_SAFE_STALLED,
        },
      },
    );
    if (result.modifiedCount > 0) {
      this.logger.warn(
        `[SpecBuildJob] Reaped ${result.modifiedCount} stale job(s)`,
      );
    }
  }

  async createQueuedJob(params: {
    projectId: string;
    userId: string;
    projectIdea: string;
    answers?: Record<string, unknown>;
    questionLabels?: Record<string, string>;
  }): Promise<{ jobId: string }> {
    const doc = await this.jobModel.create({
      projectId: params.projectId,
      userId: params.userId,
      projectIdea: params.projectIdea,
      answers: params.answers ?? {},
      questionLabels: params.questionLabels,
      status: SpecBuildJobStatus.QUEUED,
      loadingFiles: [],
    });
    const jobId = String(doc._id);
    setImmediate(() => {
      void this.processJob(jobId).catch((err) => {
        this.logger.error(
          `[SpecBuildJob] Unhandled processJob(${jobId}): ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    });
    return { jobId };
  }

  async getJobForUser(
    jobId: string,
    userId: string,
    projectId: string,
  ): Promise<SpecBuildJobSnapshot> {
    const job = await this.jobModel.findById(jobId).exec();
    if (!job) throw new NotFoundException('Job not found');
    if (String(job.userId) !== userId) {
      throw new NotFoundException('Job not found');
    }
    if (String(job.projectId) !== projectId) {
      throw new NotFoundException('Job not found');
    }
    return this.toSnapshot(job);
  }

  private toSnapshot(job: SpecBuildJob): SpecBuildJobSnapshot {
    return {
      id: String(job._id),
      status: job.status,
      buildStatus: job.buildStatus,
      mergedSha: job.mergedSha,
      prUrl: job.prUrl,
      revisionId: job.revisionId ? String(job.revisionId) : undefined,
      deploymentId: job.deploymentId,
      deployStatus: job.deployStatus,
      loadingFiles: job.loadingFiles?.length ? job.loadingFiles : undefined,
      estimate: job.estimate,
      errorMessage: job.errorMessage,
    };
  }

  private async failJob(jobId: string, message: string): Promise<void> {
    await this.jobModel.updateOne(
      { _id: jobId },
      {
        $set: {
          status: SpecBuildJobStatus.FAILED,
          errorMessage: message,
        },
      },
    );
  }

  async processJob(jobId: string): Promise<void> {
    const claimed = await this.jobModel.findOneAndUpdate(
      { _id: jobId, status: SpecBuildJobStatus.QUEUED },
      { $set: { status: SpecBuildJobStatus.RUNNING } },
      { new: true },
    );
    if (!claimed) {
      this.logger.debug(
        `[SpecBuildJob] Skip processJob(${jobId}) — not QUEUED`,
      );
      return;
    }

    const projectId = String(claimed.projectId);

    try {
      await this.repoService.runExclusive(projectId, async () => {
        const jobFresh = await this.jobModel.findById(jobId).exec();
        if (!jobFresh) throw new Error('job_missing');

        const blocking = await this.findBlockingJobForProject(projectId);
        if (blocking && String(blocking._id) !== jobId) {
          await this.failJob(jobId, USER_SAFE_INFLIGHT);
          return;
        }

        const freshAnswers = (jobFresh.answers ?? {}) as Record<
          string,
          unknown
        >;
        const palettes = palettesFromThemeAnswer(freshAnswers);
        const styleId = styleIdFromAnswers(freshAnswers);

        const result = await this.specBuildService.runSpecBuild(
          {
            projectId,
            projectIdea: jobFresh.projectIdea,
            answers: freshAnswers,
            ctx: { userId: String(jobFresh.userId), projectId },
            questionLabels: jobFresh.questionLabels,
            palettes,
            styleId,
          },
          {
            onBriefReady: async (brief) => {
              await this.jobModel.updateOne(
                { _id: jobId },
                {
                  $set: {
                    loadingFiles: brief.loadingFiles,
                    estimate: brief.estimate,
                  },
                },
              );
            },
          },
        );

        if (result.status !== 'merged' || !result.mergedSha) {
          const msg =
            result.status === 'stalemate'
              ? 'The build could not be merged automatically. Try a simpler scope.'
              : result.status === 'no_changes'
                ? 'No changes were produced. Try rephrasing your project idea.'
                : USER_SAFE_FAILED;
          await this.jobModel.updateOne(
            { _id: jobId },
            {
              $set: {
                status: SpecBuildJobStatus.FAILED,
                buildStatus: result.status,
                errorMessage: msg,
                prUrl: result.prUrl,
              },
            },
          );
          return;
        }

        await this.jobModel.updateOne(
          { _id: jobId },
          {
            $set: {
              status: SpecBuildJobStatus.DEPLOYING,
              buildStatus: result.status,
              mergedSha: result.mergedSha,
              prUrl: result.prUrl,
              revisionId: result.revisionId,
              deploymentId: result.deploymentId,
            },
          },
        );

        await this.jobModel.updateOne(
          { _id: jobId },
          {
            $set: {
              status: SpecBuildJobStatus.COMPLETED,
              deployStatus: result.deploymentId ? 'QUEUED' : undefined,
            },
          },
        );

        this.logger.log(
          `[SpecBuildJob] ${jobId} completed deploymentId=${result.deploymentId ?? 'none'}`,
        );
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`[SpecBuildJob] ${jobId} error: ${msg}`);
      const userMsg =
        /bad credentials/i.test(msg) || /401/.test(msg)
          ? USER_SAFE_GITHUB
          : /verify existence of branch|failed to determine repository default branch/i.test(
                msg,
              )
            ? USER_SAFE_CURSOR_GITHUB
            : USER_SAFE_FAILED;
      await this.failJob(jobId, userMsg);
    }
  }
}
