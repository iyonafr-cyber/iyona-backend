import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AiService, AiCallContext, BuildSpecEstimate } from '../ai/ai.service';
import {
  CursorService,
  buildFullBuildPrompt,
} from '../cursor/cursor.service';
import { RepoService } from '../repo/repo.service';
import { UiKitService } from '../ui-kit/ui-kit.service';
import { RevisionsService } from '../revisions/revisions.service';
import { UserProject } from '../projects/entities/user-project.entity';
import {
  resolveDesignStyle,
  DESIGN_STYLES,
  describeDesignStyleForPrompt,
  pickHeroTreatment,
  describeHeroTreatmentForPrompt,
  describeBlockPlanForPrompt,
} from '../ui-kit/ui-kit.constants';
import type { PaletteOverrides } from '../ui-kit/ui-kit.constants';
import { detectArchetype } from '../common/app-archetypes';
import { stockImageBlockForIdea } from '../common/stock-images';
import { isManagedProvisioningEnabled } from 'src/supabase/managed-provisioning.flag';

export interface SpecBuildRunHooks {
  /** Fired after the LLM brief is ready — used to update async job UX. */
  onBriefReady?: (payload: {
    brief: string;
    estimate: BuildSpecEstimate;
    loadingFiles: string[];
  }) => void | Promise<void>;
  /**
   * Fired once the agent prompt is composed, immediately before the Cursor run
   * starts. Carries the plan and the exact prompt so the caller can archive
   * both for later diagnosis. Separate from onBriefReady because the design
   * context — and therefore the prompt — does not exist that early.
   */
  onAgentPromptReady?: (payload: {
    brief: string;
    agentPrompt: string;
  }) => void | Promise<void>;
}

/**
 * Spec→Cursor build path — THE initial app builder (no flag, no fallback).
 *
 *   1. AiService.generateBuildSpec  — LLM brain writes the full development plan
 *   2. seed UI kit onto `main`
 *   3. CursorService.runFullBuildRound — Cursor agent worker authors the app
 *   4. deployPreview(skipCursorCleanup) — Vercel + repair loop
 */
@Injectable()
export class SpecBuildService {
  private readonly logger = new Logger(SpecBuildService.name);

  constructor(
    private readonly aiService: AiService,
    private readonly cursorService: CursorService,
    private readonly repoService: RepoService,
    private readonly uiKitService: UiKitService,
    private readonly revisionsService: RevisionsService,
    @InjectModel(UserProject.name)
    private readonly projectModel: Model<UserProject>,
  ) {}

  async runSpecBuild(
    input: {
      projectId: string;
      /** When omitted, resolved from project.jarvisGithub. */
      owner?: string;
      repo?: string;
      projectIdea: string;
      answers: Record<string, unknown>;
      ctx: AiCallContext;
      questionLabels?: Record<string, string>;
      palettes?: PaletteOverrides;
      /**
       * Base hexes the kit was seeded with (explicit theme colors, else the
       * per-project auto bases). Persisted on the project so revisions/redeploys
       * re-derive the SAME colors — this is what scopes the auto palette to new
       * builds only. Omitted → nothing persisted (pre-existing behavior).
       */
      paletteBases?: {
        primary?: string;
        accent?: string;
        background?: string;
        foreground?: string;
      };
      /** Design style id chosen in the questionnaire ('auto' / unset → pick). */
      styleId?: string;
    },
    hooks?: SpecBuildRunHooks,
  ): Promise<{
    spec: string;
    estimate: BuildSpecEstimate;
    loadingFiles: string[];
    status: 'merged' | 'no_changes' | 'stalemate' | 'failed';
    mergedSha?: string;
    prUrl?: string;
    revisionId?: string;
    deploymentId?: string;
  }> {
    const { projectId, projectIdea, answers, ctx } = input;
    let { owner, repo } = input;

    const project = await this.projectModel.findById(projectId).exec();
    if (!project) {
      throw new NotFoundException(`Project ${projectId} not found`);
    }

    if (!project.jarvisGithub) {
      const repoInfo = await this.repoService.createProjectRepo(
        project.name ?? `project-${projectId}`,
      );
      project.jarvisGithub = {
        owner: repoInfo.owner,
        repo: repoInfo.repo,
        defaultBranch: repoInfo.defaultBranch,
        htmlUrl: repoInfo.htmlUrl,
        createdAt: new Date(),
      };
      await project.save();
      this.logger.log(
        `[SpecBuild] Created GitHub repo ${repoInfo.owner}/${repoInfo.repo} for project ${projectId}`,
      );
    }

    if (!owner || !repo) {
      owner = project.jarvisGithub!.owner;
      repo = project.jarvisGithub!.repo;
    }

    // Auto-provisioning kicked off at project creation (AI DB detection or
    // the withDatabase toggle) may still be in flight — wait for it here so
    // the plan gets real Supabase guidance instead of mock-data defaults.
    // Deploy gates on readiness separately; this only affects the brief.
    //
    // Decision 07 — skip the wait entirely when managed provisioning is off.
    // A BYO database becomes ready when the owner connects it from settings,
    // on their own schedule, so there is no in-flight run to wait for and this
    // loop would just burn three minutes before reaching the same conclusion.
    let supabaseSnapshot = project.supabase;
    if (isManagedProvisioningEnabled()) {
      const deadline = Date.now() + 3 * 60_000;
      while (
        (supabaseSnapshot?.status === 'pending' ||
          supabaseSnapshot?.status === 'provisioning') &&
        Date.now() < deadline
      ) {
        await new Promise((r) => setTimeout(r, 3000));
        const doc = await this.projectModel
          .findById(projectId)
          .select('supabase')
          .lean()
          .exec();
        supabaseSnapshot = doc?.supabase ?? supabaseSnapshot;
      }
      if (supabaseSnapshot?.status === 'ready') {
        this.logger.log(
          `[SpecBuild] Supabase ready for project ${projectId} — plan will include real DB guidance`,
        );
      }
    }

    // Gate real-integration guidance on what the project has actually
    // provisioned so the plan never references env vars that don't exist.
    const buildIntegrations = {
      supabase:
        supabaseSnapshot?.status === 'ready' && Boolean(supabaseSnapshot?.url),
      stripe:
        project.paymentConfig?.enabled === true &&
        Boolean(project.paymentConfig?.stripePublishableKey),
    };

    const { brief, estimate, loadingFiles } =
      await this.aiService.generateBuildSpec(
        projectIdea,
        answers,
        ctx,
        input.questionLabels,
        buildIntegrations,
      );
    this.logger.log(
      `[SpecBuild] Brief generated for project=${projectId} (${brief.length} chars) — ` +
        `est ~${estimate.buildSeconds}s, ~${estimate.tokens} tokens, ~${estimate.fileCount} files, ` +
        `${loadingFiles.length} loading-screen paths`,
    );

    await hooks?.onBriefReady?.({ brief, estimate, loadingFiles });

    // Resolve the CONCRETE design style once: honor an explicit pick, else pick
    // from the site category's pool (so e.g. a portfolio/fashion store can get
    // the zero-radius `sharp` look, SaaS gets geometric, etc.). We persist the
    // resolved id — even on Auto — so every later revision/redeploy re-seeds the
    // SAME style instead of re-deriving it. Pre-existing projects (no stored id)
    // keep resolving through the untouched legacy pool, so none are restyled.
    const categoryId = detectArchetype(input.projectIdea).id;
    const designStyle = resolveDesignStyle(
      input.styleId,
      projectId,
      categoryId,
    );
    let projectDirty = false;
    if (
      DESIGN_STYLES[designStyle.id] &&
      project.designStyleId !== designStyle.id
    ) {
      project.designStyleId = designStyle.id;
      projectDirty = true;
    }
    // Persist the seeded palette bases so every later revision/redeploy reads
    // these SAME colors (via project.designSystemColors) instead of falling back
    // to the shared default blue. Only sets when empty — an explicit palette the
    // front-end already saved is never overwritten. Pre-existing projects, which
    // never get here, keep their current default and are not recolored.
    if (input.paletteBases && !project.designSystemColors) {
      project.designSystemColors = input.paletteBases;
      projectDirty = true;
    }
    if (projectDirty) {
      await project.save();
    }
    const kitFiles = this.uiKitService.getInitialFiles(
      input.palettes,
      designStyle,
    );
    await this.repoService.commitTree(
      owner,
      repo,
      kitFiles,
      `seed: UI kit v${this.uiKitService.version} (spec-build)`,
    );
    this.logger.log(
      `[SpecBuild] Seeded ${Object.keys(kitFiles).length} UI kit files to ${owner}/${repo}@main`,
    );

    // Per-project design context for the WORKER. The worker authors all the
    // visible markup but its task prompt is static — the persona, palette,
    // mandated hero and verified image library must be handed to it directly,
    // not hoped-for via the plan prose. Same resolved style/hero/library the
    // plan prompt used (same seed + idea), so brain and worker always agree.
    const designContext = [
      describeDesignStyleForPrompt(designStyle),
      input.paletteBases?.primary
        ? `Brand palette (already seeded as kit tokens): primary ${input.paletteBases.primary}${input.paletteBases.accent ? `, accent ${input.paletteBases.accent}` : ''} — reference via token classes (bg-primary-600 …), never hex literals.`
        : '',
      describeHeroTreatmentForPrompt(pickHeroTreatment(projectId, designStyle)),
      '',
      describeBlockPlanForPrompt(designStyle, projectId),
      '',
      stockImageBlockForIdea(input.projectIdea),
    ]
      .filter(Boolean)
      .join('\n');

    // Archive the plan and the exact prompt before the run — composed with the
    // same function the agent call uses, so what is stored is what was sent.
    // Best-effort: a failed archive write must never abort a paid build.
    try {
      await hooks?.onAgentPromptReady?.({
        brief,
        agentPrompt: buildFullBuildPrompt(brief, designContext),
      });
    } catch (err) {
      this.logger.warn(
        `[SpecBuild] Could not archive build prompt for ${projectId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    const result = await this.cursorService.runFullBuildRound({
      owner,
      repo,
      projectId,
      spec: brief,
      context: designContext,
    });
    this.logger.log(
      `[SpecBuild] Full build → ${result.status}${result.mergedSha ? ` sha=${result.mergedSha}` : ''}`,
    );

    let revisionId: string | undefined;
    let deploymentId: string | undefined;
    if (result.status === 'merged' && result.mergedSha) {
      const revision =
        await this.revisionsService.createDeployableRevisionFromCommit(
          projectId,
          result.mergedSha,
          { commitMessage: 'spec-build: Cursor full build' },
        );
      revisionId = revision._id;
      // Cursor already authored + build-verified the app; skip the extra
      // cleanup round and go straight to Vercel (repair loop still applies).
      const deploy = await this.revisionsService.deployPreview(
        projectId,
        revision._id,
        'vite',
        { skipCursorCleanup: true },
      );
      deploymentId = deploy.deploymentId;
      this.logger.log(
        `[SpecBuild] Deploy queued project=${projectId} revision=${revisionId} deployment=${deploymentId}`,
      );
    }

    return {
      spec: brief,
      estimate,
      loadingFiles,
      status:
        result.status === 'merged'
          ? 'merged'
          : result.status === 'no_changes'
            ? 'no_changes'
            : result.status === 'stalemate'
              ? 'stalemate'
              : 'failed',
      mergedSha: result.mergedSha,
      prUrl: result.prUrl,
      revisionId,
      deploymentId,
    };
  }
}
