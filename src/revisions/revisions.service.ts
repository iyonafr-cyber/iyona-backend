import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  forwardRef,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  Revision,
  RevisionStatus,
  RevisionFailureReason,
  type RevisionValidationError,
} from './entities/revision.entity';
import { Deployment, DeploymentStatus } from './entities/deployment.entity';
import {
  UserProject,
  ProjectStatus,
} from '../projects/entities/user-project.entity';
import { S3Service } from '../s3/s3.service';
import { VercelService } from '../vercel/vercel.service';
import { SupabaseService } from '../supabase/supabase.service';
import { SupabaseSchemaService } from '../supabase/supabase-schema.service';
import { resolveSqlTarget } from '../projects/supabase-sql-target';
import { extractSchemaDeclaration } from '../common/schema-extractor';
import type { IEncryptionService } from '../encryption/interface/encryption.interface.service';
import { CreateRevisionDto } from './dto/create-revision.dto';
import { RevisionDto } from './dto/revision.dto';
import { ProjectsService } from '../projects/projects.service';
import { DeployPreviewResponseDto } from './dto/deploy-preview.dto';
import { plainToInstance } from 'class-transformer';
import { assertSafeRelativePath } from '../common/safe-path';
import {
  evaluateCompleteness,
  formatCompletenessHintForCursor,
  buildCompletenessScorecard,
} from '../common/content-completeness';
import { UiKitService } from '../ui-kit/ui-kit.service';
import { palettesFromDesignSystem } from '../ui-kit/palette-generator';
import { resolveDesignStyle } from '../ui-kit/ui-kit.constants';
import {
  findEnvExampleContent,
  parseEnvExampleKeys,
} from '../common/parse-env-example';
import { mergeProjectDeployBuildEnv } from '../common/project-build-env-merge';
import {
  stripVercelProtectionBypass,
  withVercelProtectionBypass,
  iyonaVercelPublicPreviewUrl,
} from '../vercel/vercel-deployment-url.util';
import {
  pickFirstPreviewUrlRaw,
  finalizePreviewUrlForApi,
} from './revisions-preview-url.resolver';
import { RepoService } from '../repo/repo.service';
import { CursorService } from '../cursor/cursor.service';

/** When metadata.cursorUserTask is absent, infer task from known deploy commit prefixes. */
function cursorTaskFromCommitMessage(
  commitMessage: string | undefined,
): string | undefined {
  if (!commitMessage || typeof commitMessage !== 'string') return undefined;
  const cm = commitMessage.trim();
  if (cm.startsWith('Update:')) {
    const t = cm.slice('Update:'.length).trim();
    return t.length > 0 ? t : undefined;
  }
  if (cm.startsWith('deploy:')) {
    const t = cm.slice('deploy:'.length).trim();
    return t.length > 0 ? t : undefined;
  }
  return undefined;
}

@Injectable()
export class RevisionsService {
  private readonly logger = new Logger(RevisionsService.name);

  // Hard limits on a single revision payload. These protect S3, MongoDB, and
  // our downstream Vercel deploy from runaway payloads.
  private static readonly MAX_FILES_PER_REVISION = 1000;
  private static readonly MAX_TOTAL_BYTES_PER_REVISION = 8 * 1024 * 1024; // 8 MB
  private static readonly MAX_BYTES_PER_FILE = 2 * 1024 * 1024; // 2 MB

  constructor(
    @InjectModel(Revision.name) private revisionModel: Model<Revision>,
    @InjectModel(Deployment.name) private deploymentModel: Model<Deployment>,
    @InjectModel(UserProject.name) private projectModel: Model<UserProject>,
    private readonly s3Service: S3Service,
    private readonly vercelService: VercelService,
    private readonly supabaseService: SupabaseService,
    private readonly configService: ConfigService,
    @Inject(forwardRef(() => ProjectsService))
    private readonly projectsService: ProjectsService,
    @Inject('IEncryptionService')
    private readonly encryptionService: IEncryptionService,
    private readonly repoService: RepoService,
    private readonly cursorService: CursorService,
    private readonly supabaseSchemaService: SupabaseSchemaService,
    private readonly uiKitService: UiKitService,
  ) {}

  /**
   * Build the project-scoped env block we forward to Vercel at deploy
   * time. Today this only carries the Supabase URL + anon key when the
   * project has a `ready` Supabase config (E1). Service-role keys are
   * intentionally excluded — they live server-side on the Supabase
   * Edge Functions runtime, never in the deployed Vite bundle.
   */
  private buildSupabaseBuildEnv(
    project: UserProject,
  ): Record<string, string> | undefined {
    const sb = project.supabase;
    if (!sb || sb.status !== 'ready' || !sb.url) return undefined;
    // PR-2.C — prefer the encrypted anonKey; fall back to the legacy
    // plaintext field so projects provisioned before encryption-at-rest
    // keep deploying. If neither is set we skip the env entirely
    // (the generated app will run without Supabase wiring).
    let anonKey: string | undefined;
    if (sb.anonKeyEnc) {
      try {
        anonKey = this.encryptionService.decrypt(sb.anonKeyEnc);
      } catch (err) {
        this.logger.warn(
          `Failed to decrypt anonKey for project ${String(project._id)}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
    if (!anonKey) anonKey = sb.anonKey;
    if (!anonKey) return undefined;
    return {
      VITE_SUPABASE_URL: sb.url,
      VITE_SUPABASE_ANON_KEY: anonKey,
    };
  }

  /**
   * Apply the declarative schema to the Supabase project. Extracts
   * the ===SCHEMA=== block from the generated files (stored as a
   * special `__schema__.json` entry by the generation pipeline), or
   * falls back to scanning for legacy migration files.
   *
   * New flow: schema declaration JSON → SupabaseSchemaService.applySchema()
   * Legacy flow: supabase/migrations/*.sql → SupabaseService.applyMigrations()
   */
  private async applySupabaseSchemaForRevision(
    project: UserProject,
    files: Record<string, string>,
  ): Promise<void> {
    const sb = project.supabase;
    if (!sb || sb.status !== 'ready') return;

    const projectIdStr = String(project._id);

    // Decision 07 — where DDL goes depends on what the owner gave us. Managed
    // projects go through the Management API; BYO projects with a connection
    // string go straight to Postgres; BYO projects without one can't be
    // migrated by Iyona at all, so we hand the owner the SQL instead of
    // failing the deploy.
    const resolved = resolveSqlTarget(
      sb,
      (cipher) => this.encryptionService.decrypt(cipher),
      projectIdStr,
    );
    if (resolved.mode === 'none') return;
    if (resolved.mode === 'manual' || !resolved.target) {
      await this.storePendingMigrationSql(project, files, resolved.error);
      return;
    }
    const target = resolved.target;

    // Try new declarative schema from __schema__.json (injected by generation pipeline)
    const schemaJson = files['__schema__.json'];
    if (schemaJson) {
      try {
        const schema = JSON.parse(schemaJson);
        const result = await this.supabaseSchemaService.applySchema(
          target,
          schema,
        );
        if (result.success) {
          this.logger.log(
            `Schema applied for project ${projectIdStr}: ${result.tablesApplied.join(', ')}`,
          );
          await this.projectModel
            .updateOne(
              { _id: project._id },
              {
                $set: { 'supabase.lastAppliedSchema': schema },
                $unset: {
                  'supabase.lastSchemaError': '',
                  // The schema is live now — any copy-paste script we handed
                  // the owner earlier is stale, and leaving it on screen
                  // invites them to run obsolete SQL.
                  'supabase.pendingMigrationSql': '',
                  'supabase.pendingMigrationAt': '',
                },
              },
            )
            .exec();
        } else {
          const errSummary = result.errors
            .map((e) => `${e.table}: ${e.error}`)
            .join('; ');
          this.logger.warn(
            `Schema apply failed for project ${projectIdStr}: ${errSummary}`,
          );
          await this.projectModel
            .updateOne(
              { _id: project._id },
              { $set: { 'supabase.lastSchemaError': errSummary } },
            )
            .exec();
        }
        return; // New flow handled — skip legacy
      } catch (err) {
        const message = err instanceof Error ? err.message : 'unknown error';
        this.logger.warn(
          `Schema JSON parse/apply failed for project ${projectIdStr}: ${message}; falling back to legacy migrations`,
        );
      }
    }

    // Legacy fallback: migration files (deprecated, kept for backwards compat)
    const migrationEntries = Object.entries(files)
      .filter(([path]) => /(^|\/)supabase\/migrations\/[^/]+\.sql$/i.test(path))
      .map(([path, sql]) => ({
        name: path.split('/').pop() ?? path,
        sql,
      }));

    if (migrationEntries.length === 0) return;

    try {
      const result = await this.supabaseService.applyMigrations(
        target,
        migrationEntries,
      );
      if (result.applied.length > 0) {
        this.logger.log(
          `Legacy Supabase migrations applied for project ${projectIdStr}: ${result.applied.join(', ')}`,
        );
      }
      if (result.failed.length > 0) {
        const errSummary = result.failed
          .map((f) => `${f.name}: ${f.error}`)
          .join('; ');
        this.logger.warn(
          `Legacy Supabase migrations failed for project ${projectIdStr}: ${errSummary}`,
        );
        await this.projectModel
          .updateOne(
            { _id: project._id },
            { $set: { 'supabase.lastSchemaError': errSummary } },
          )
          .exec();
      } else if (result.applied.length > 0) {
        await this.projectModel
          .updateOne(
            { _id: project._id },
            {
              $unset: {
                'supabase.lastSchemaError': '',
                'supabase.pendingMigrationSql': '',
                'supabase.pendingMigrationAt': '',
              },
            },
          )
          .exec();
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown error';
      this.logger.error(
        `Legacy Supabase applyMigrations threw for project ${projectIdStr}: ${message}`,
      );
      await this.projectModel
        .updateOne(
          { _id: project._id },
          { $set: { 'supabase.lastSchemaError': message } },
        )
        .exec()
        .catch(() => undefined);
    }
  }

  /**
   * Manual migration path (decision 07): the project has a database Iyona
   * cannot run DDL against, so render the schema changes as a SQL script and
   * park it on the project for the settings panel to show.
   *
   * This deliberately does not fail the deploy. The app still builds and ships
   * — it simply queries tables that may not exist yet, which is exactly the
   * state the owner is in until they run the script. Blocking the deploy would
   * strand them with no app AND no SQL.
   */
  private async storePendingMigrationSql(
    project: UserProject,
    files: Record<string, string>,
    resolveError?: string,
  ): Promise<void> {
    const projectIdStr = String(project._id);
    let sql: string | undefined;

    const schemaJson = files['__schema__.json'];
    if (schemaJson) {
      try {
        sql = this.supabaseSchemaService.buildSchemaSql(JSON.parse(schemaJson));
      } catch (err) {
        this.logger.warn(
          `Could not render pending schema SQL for project ${projectIdStr}: ${
            err instanceof Error ? err.message : 'unknown error'
          }`,
        );
      }
    }

    if (!sql) {
      // Legacy migration files — concatenate in the same order applyMigrations
      // would have run them.
      const entries = Object.entries(files)
        .filter(([path]) =>
          /(^|\/)supabase\/migrations\/[^/]+\.sql$/i.test(path),
        )
        .map(([path, body]) => ({ name: path.split('/').pop() ?? path, body }))
        .sort((a, b) => a.name.localeCompare(b.name));
      if (entries.length === 0) return;
      sql = entries
        .map((e) => `-- ── ${e.name} ──\n${e.body.trim()}`)
        .join('\n\n');
    }

    await this.projectModel
      .updateOne(
        { _id: project._id },
        {
          $set: {
            'supabase.pendingMigrationSql': sql,
            'supabase.pendingMigrationAt': new Date(),
            ...(resolveError
              ? { 'supabase.lastSchemaError': resolveError }
              : {}),
          },
        },
      )
      .exec();

    this.logger.log(
      `Pending schema SQL stored for project ${projectIdStr} — owner must run it in the Supabase SQL editor`,
    );
  }

  /**
   * E13 — analytics provider env injected into the Vite build. The
   * generated app reads these at boot to wire Plausible / PostHog (or
   * to skip both when `provider === 'none'`). Returns `undefined` when
   * analytics are disabled so we don't pollute the build env.
   */
  private buildAnalyticsBuildEnv(
    project: UserProject,
  ): Record<string, string> | undefined {
    const a = project.analytics;
    if (!a || !a.provider || a.provider === 'none') return undefined;
    const env: Record<string, string> = {
      VITE_ANALYTICS_PROVIDER: a.provider,
    };
    if (a.key) env.VITE_ANALYTICS_KEY = a.key;
    if (a.host) env.VITE_ANALYTICS_HOST = a.host;
    return env;
  }

  /**
   * Stripe publishable key for the deployed bundle. Only the publishable key
   * (pk_...) is exposed to the frontend — the secret key is never injected
   * client-side. Emitted only when payments are enabled and a key is set.
   */
  private buildStripeBuildEnv(
    project: UserProject,
  ): Record<string, string> | undefined {
    const p = project.paymentConfig;
    if (!p?.enabled || !p.stripePublishableKey) return undefined;
    return {
      VITE_STRIPE_PUBLISHABLE_KEY: p.stripePublishableKey,
    };
  }

  /**
   * Owner-stored secrets for keys declared in `.env.example`; filtered
   * identically to {@link VercelService.filterEnvVars} before merge.
   */
  private buildUserAppSecretsBuildEnv(
    project: UserProject,
    files: Record<string, string>,
  ): Record<string, string> | undefined {
    const raw = findEnvExampleContent(files);
    if (!raw) return undefined;
    const { keys } = parseEnvExampleKeys(raw);
    if (keys.length === 0) return undefined;
    const enc = project.appBuildSecretsEnc;
    if (!enc || Object.keys(enc).length === 0) return undefined;
    const plain: Record<string, string> = {};
    for (const k of keys) {
      const c = enc[k];
      if (!c) continue;
      try {
        plain[k] = this.encryptionService.decrypt(c);
      } catch (err) {
        this.logger.warn(
          `Failed to decrypt appBuildSecretsEnc.${k} for project ${String(project._id)}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
    if (Object.keys(plain).length === 0) return undefined;
    const filtered = VercelService.filterEnvVars(
      plain,
      String(project._id),
      this.logger,
    );
    return filtered && Object.keys(filtered).length > 0 ? filtered : undefined;
  }

  /**
   * Create a new revision for a project
   * Uploads files to S3 and creates a revision record
   */
  async createRevision(
    projectId: string,
    createRevisionDto: CreateRevisionDto,
  ): Promise<RevisionDto> {
    let files = createRevisionDto.files;
    this.assertRevisionWithinLimits(files);

    // Verify project exists and has not been soft-deleted.
    // This guard runs before any S3 write so we never create orphaned
    // S3 objects or Mongo revision docs for a deleted project.
    const project = await this.projectModel.findById(projectId).exec();
    if (!project) {
      throw new NotFoundException(`Project ${projectId} not found`);
    }
    if (project.deletedAt) {
      throw new NotFoundException(
        `Project ${projectId} has been deleted and cannot accept new revisions`,
      );
    }

    // Get next version number
    const latestRevision = await this.revisionModel
      .findOne({ projectId })
      .sort({ version: -1 })
      .exec();
    const nextVersion = (latestRevision?.version || 0) + 1;

    // ── UI Kit injection / lock ───────────────────────────────────────────
    // v1 (initial generation): merge the built-in component library into the
    // file map. Kit files always win on path collision.
    // v2+ (mutation): enforce kit lock — restore canonical kit files, unless
    // the user explicitly opted into design-system edits.
    const allowDesignSystemEdits =
      createRevisionDto.metadata?.allowDesignSystemEdits === true;
    let kitCollisions: string[] = [];

    // Resolve palette overrides from:
    //   1. metadata.designSystemColors on the DTO (front-end passes them)
    //   2. project.designSystemColors (persisted from a previous generation)
    // First source that has colors wins.
    const dsColors =
      createRevisionDto.metadata?.designSystemColors ??
      project.designSystemColors;
    const palettes = palettesFromDesignSystem(dsColors);

    // Persist on the project for future revisions (mutations) so they get the
    // same palette without the front-end re-sending it every time.
    if (dsColors && !project.designSystemColors) {
      project.designSystemColors = dsColors;
      await project.save();
    }

    const designStyle = resolveDesignStyle(project.designStyleId, projectId);
    if (nextVersion === 1) {
      const result = this.uiKitService.mergeIntoFileMap(
        files,
        palettes,
        designStyle,
      );
      files = result.merged;
      kitCollisions = result.collisions;
      if (kitCollisions.length > 0) {
        this.logger.warn(
          `UI kit merge for project ${projectId}: ${kitCollisions.length} collision(s): ${kitCollisions.join(', ')}`,
        );
      }
    } else if (!allowDesignSystemEdits) {
      files = this.uiKitService.enforceKitLock(files, palettes, designStyle);
    }

    // ── Content-completeness gate ─────────────────────────────────────────
    // Build-time checks (tsc / vite) don't catch placeholder content — a file
    // that just renders <h1>Welcome to Our App</h1> + "Description of feature
    // one" compiles fine and ships. This gate scans for stub patterns so we
    // can surface (and optionally block) those revisions before deploy.
    // Runs AFTER kit merge so kit files don't trigger false positives.
    const completenessReport = evaluateCompleteness(files);
    if (!completenessReport.ok) {
      this.logger.warn(
        `Revision for project ${projectId} flagged by completeness gate: ` +
          `${completenessReport.issues.length} issue(s) across ` +
          `${completenessReport.stubPaths.length} file(s). ` +
          `First issues: ${completenessReport.issues
            .slice(0, 5)
            .map((i) => `${i.path}[${i.reason}]`)
            .join(', ')}`,
      );
      const strict =
        this.configService.get<string>('STRICT_COMPLETENESS_GATE') === 'true';
      if (strict) {
        throw new BadRequestException(
          `Generated revision failed completeness gate: ` +
            `${completenessReport.stubPaths.length} stub file(s) detected ` +
            `(${completenessReport.issues
              .slice(0, 3)
              .map((i) => `${i.path}: ${i.reason}`)
              .join('; ')})`,
        );
      }
    }

    // Create revision record
    const revision = new this.revisionModel({
      projectId,
      version: nextVersion,
      fileCount: Object.keys(files).length,
      status: RevisionStatus.PENDING,
      commitMessage: createRevisionDto.commitMessage,
      metadata: {
        ...(createRevisionDto.metadata ?? {}),
        uiKitVersion: this.uiKitService.version,
        uiKitCollisions: kitCollisions,
        completeness: {
          ok: completenessReport.ok,
          stubCount: completenessReport.stubPaths.length,
          missingCount: completenessReport.missing.length,
          issues: completenessReport.issues.slice(0, 50),
        },
      },
    });

    await revision.save();

    try {
      // ── Push generated tree to GitHub (canonical source) ──────────────────
      // Create the Iyona-owned repo on first revision; subsequent revisions
      // push new commits onto the same repo.
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
      }

      const { owner, repo } = project.jarvisGithub;
      const { sha: initialSha } = await this.repoService.commitTree(
        owner,
        repo,
        files,
        `gen: revision ${revision._id} (v${nextVersion})`,
      );

      revision.initialCommitSha = initialSha;
      revision.status = RevisionStatus.UPLOADED;
      await revision.save();

      // Update project's current revision
      project.currentRevision = nextVersion;
      project.latestRevisionId = revision._id;
      await project.save();

      this.logger.log(
        `Created revision ${nextVersion} for project ${projectId} with ${Object.keys(files).length} files`,
      );

      return this.revisionDocumentToDto(revision);
    } catch (error) {
      // Mark revision as failed
      revision.status = RevisionStatus.FAILED;
      revision.errorMessage = error.message;
      await revision.save();

      throw error;
    }
  }

  /**
   * Spec→Cursor path (prototype): mint a deployable revision that points at an
   * existing GitHub commit (the SHA the Cursor full-build round merged into
   * `main`). Unlike {@link createRevision}, this pushes NO files and runs NO
   * completeness gate — the authoritative tree is already on `main`. The
   * resulting revision is `UPLOADED` and can be handed straight to
   * {@link deployPreview} (with `skipCursorCleanup: true`).
   */
  async createDeployableRevisionFromCommit(
    projectId: string,
    commitSha: string,
    opts?: { commitMessage?: string },
  ): Promise<RevisionDto> {
    const project = await this.projectModel.findById(projectId).exec();
    if (!project) throw new NotFoundException(`Project ${projectId} not found`);
    if (!project.jarvisGithub) {
      throw new BadRequestException(
        `Project ${projectId} has no GitHub repository to deploy from.`,
      );
    }

    const revision = await this.createRevisionForProject(
      projectId,
      (version) => ({
        projectId,
        version,
        status: RevisionStatus.UPLOADED,
        initialCommitSha: commitSha,
        commitMessage: opts?.commitMessage ?? `spec-build: v${version}`,
        metadata: {
          source: 'spec_build',
          uiKitVersion: this.uiKitService.version,
        },
      }),
    );

    project.currentRevision = revision.version;
    project.latestRevisionId = revision._id;
    await project.save();

    this.logger.log(
      `Created spec-build revision v${revision.version} for project ${projectId} @ ${commitSha}`,
    );

    return this.revisionDocumentToDto(revision);
  }

  /**
   * Roll back to a previous revision by REDEPLOYING its pinned GitHub commit as
   * a NEW revision — forward-only, never a destructive history rewrite. The old
   * good commit is already on `main` (every revision squash-merges into it), so
   * this just creates a fresh revision pointing at that SHA and runs the normal
   * deploy pipeline. Intentionally lightweight: it reuses the exact machinery a
   * normal deploy uses. (The Cursor agent can also perform semantic reverts via
   * a chat prompt; this is the deterministic "put the site back to version N".)
   */
  async rollbackToRevision(
    projectId: string,
    revisionId: string,
    framework = 'vite',
  ): Promise<DeployPreviewResponseDto> {
    const target = await this.revisionModel.findById(revisionId).exec();
    if (!target || String(target.projectId) !== projectId) {
      throw new NotFoundException(
        `Revision ${revisionId} not found for project ${projectId}`,
      );
    }
    // Prefer the commit that was actually deployed for that revision; fall back
    // to the commit it was built from.
    const commitSha = target.deployCommitSha || target.initialCommitSha;
    if (!commitSha) {
      throw new BadRequestException(
        'This revision has no recorded commit to roll back to.',
      );
    }

    const newRevision = await this.createDeployableRevisionFromCommit(
      projectId,
      commitSha,
      { commitMessage: `rollback: to v${target.version}` },
    );

    return this.deployPreview(projectId, newRevision._id, framework);
  }

  /**
   * Public, race-safe revision creator for callers outside this service
   * (workspace deploy, cursor-update job). Allocates the next version number
   * atomically and returns the created document. Does NOT update the project's
   * `currentRevision`/`latestRevisionId` — the caller owns that write.
   */
  async createUploadedRevisionAtomic(
    projectId: string,
    base: {
      fileCount?: number;
      initialCommitSha: string;
      commitMessage: string;
      metadata?: Record<string, unknown>;
    },
  ): Promise<Revision> {
    return this.createRevisionForProject(projectId, (version) => ({
      projectId,
      version,
      ...(base.fileCount != null ? { fileCount: base.fileCount } : {}),
      status: RevisionStatus.UPLOADED,
      initialCommitSha: base.initialCommitSha,
      commitMessage: base.commitMessage,
      ...(base.metadata ? { metadata: base.metadata } : {}),
    }));
  }

  /**
   * Atomically create a revision with the next version number for a project,
   * safe against concurrent creators (double-submit, or two replicas). Reads
   * the current max version and inserts version+1; the UNIQUE `{projectId,
   * version}` index rejects a colliding insert with E11000, and we retry with a
   * freshly-read max. This is the single choke point every revision creator
   * should go through so version numbers can never collide or skip silently.
   */
  private async createRevisionForProject(
    projectId: string,
    buildDoc: (version: number) => Record<string, unknown>,
  ): Promise<Revision> {
    const MAX_ATTEMPTS = 6;
    let lastErr: unknown;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const latest = await this.revisionModel
        .findOne({ projectId })
        .sort({ version: -1 })
        .select('version')
        .lean()
        .exec();
      const version = (latest?.version ?? 0) + 1;
      try {
        return await this.revisionModel.create(buildDoc(version));
      } catch (err) {
        lastErr = err;
        const isDup =
          !!err &&
          typeof err === 'object' &&
          (err as { code?: number }).code === 11000;
        if (!isDup) throw err;
        // Lost the race for this version — loop and read a fresh max.
      }
    }
    throw new Error(
      `Failed to allocate a revision version for project ${projectId} after ${MAX_ATTEMPTS} attempts: ${
        lastErr instanceof Error ? lastErr.message : String(lastErr)
      }`,
    );
  }

  /**
   * Start deploying a revision. Returns immediately (202) with a polling key.
   * All slow work (AI repair, Vercel create) runs in the background.
   * Clients poll `getDeploymentProgress` for status.
   */
  async deployPreview(
    projectId: string,
    revisionId: string,
    framework: string = 'vite',
    options?: { skipCursorCleanup?: boolean },
  ): Promise<DeployPreviewResponseDto> {
    // ── FAST SYNC VALIDATIONS (always fast, < 3s) ────────────────────────────
    const revision = await this.revisionModel.findById(revisionId).exec();
    if (!revision)
      throw new NotFoundException(`Revision ${revisionId} not found`);

    if (revision.projectId.toString() !== projectId)
      throw new BadRequestException('Revision does not belong to this project');

    if (revision.status !== RevisionStatus.UPLOADED)
      throw new BadRequestException(
        `Revision is not ready for deployment. Current status: ${revision.status}`,
      );

    const project = await this.projectModel.findById(projectId).exec();
    if (!project) throw new NotFoundException(`Project ${projectId} not found`);

    if (!project.jarvisGithub || !revision.initialCommitSha) {
      throw new BadRequestException(
        `Revision ${revisionId} has no GitHub-backed source tree. ` +
          `Re-generate the project to create a canonical GitHub repository.`,
      );
    }

    // ── CREATE QUEUED DEPLOYMENT — return this ID to the client immediately ──
    const pollingId = `pending_${String(revision._id)}`;
    const deployment = new this.deploymentModel({
      projectId,
      revisionId,
      vercelDeploymentId: pollingId,
      status: DeploymentStatus.QUEUED,
      metadata: { clientPollingDeploymentId: pollingId },
    });
    await deployment.save();

    revision.status = RevisionStatus.DEPLOYING;
    await revision.save();

    project.status = ProjectStatus.BUILDING;
    project.latestDeploymentId = deployment._id;
    project.framework = framework;
    await project.save();

    // ── BACKGROUND: GitHub → Cursor cleanup → Vercel → repair loop ───────────
    void this.runDeployPipeline({
      projectId,
      revisionId: String(revision._id),
      deploymentMongoId: String(deployment._id),
      pollingId,
      initialCommitSha: revision.initialCommitSha,
      framework,
      ownerUserId: String(project.userId),
      skipCursorCleanup: options?.skipCursorCleanup === true,
    });

    return {
      deploymentId: pollingId,
      previewUrl: '',
      deploymentUrl: '',
      status: 'QUEUED',
    };
  }

  /**
   * GitHub → Cursor cleanup → Vercel deploy → Cursor repair loop.
   * Runs fully in the background after `deployPreview` returns 202.
   *
   * Flow:
   *  1. Cursor cleanup round (attempt=0) — always runs.
   *  2. Deploy loop (up to 1+3 = 4 Vercel deploys):
   *     a. Read tree from GitHub at current SHA.
   *     b. Apply Supabase migrations + build env, then call createDeployment
   *        (which applies preview-bridge, SEO, click-to-edit, strips .env).
   *     c. Wait for Vercel outcome via webhook + polling hybrid.
   *     d. READY → finalize (alias, update docs). Done.
   *     e. ERROR → fetch build logs → Cursor repair (attempt 1..3) → new SHA → loop.
   *  3. After 3 repair failures → fail revision.
   */
  private async runDeployPipeline(payload: {
    projectId: string;
    revisionId: string;
    deploymentMongoId: string;
    pollingId: string;
    initialCommitSha: string;
    framework: string;
    ownerUserId: string;
    /** When true, skip Cursor cleanup (agent already edited GitHub, e.g. workspace cursor-update). */
    skipCursorCleanup?: boolean;
  }): Promise<void> {
    const {
      projectId,
      revisionId,
      deploymentMongoId,
      pollingId,
      initialCommitSha,
      framework,
      ownerUserId,
      skipCursorCleanup = false,
    } = payload;

    const failPipeline = async (
      err: unknown,
      reason: RevisionFailureReason = RevisionFailureReason.DEPLOY,
    ) => {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`[DeployPipeline] project ${projectId} failed: ${msg}`);
      await this.markDeploymentFailed(
        deploymentMongoId,
        revisionId,
        projectId,
        msg,
        'pipeline',
        false,
      );
      await this.revisionModel
        .findByIdAndUpdate(revisionId, { $set: { failureReason: reason } })
        .exec()
        .catch(() => undefined);
    };

    try {
      const project = await this.projectModel.findById(projectId).exec();
      if (!project?.jarvisGithub) {
        throw new Error(`Project ${projectId} has no GitHub repo configured`);
      }
      const { owner, repo } = project.jarvisGithub;

      const revisionLean = await this.revisionModel
        .findById(revisionId)
        .select('version metadata commitMessage')
        .lean()
        .exec();
      const revisionVersion = revisionLean?.version ?? 1;
      const revMeta = revisionLean?.metadata as
        | Record<string, unknown>
        | undefined;
      let cursorUserTask =
        typeof revMeta?.cursorUserTask === 'string'
          ? revMeta.cursorUserTask
          : undefined;
      if (cursorUserTask == null && revisionVersion > 1) {
        cursorUserTask = cursorTaskFromCommitMessage(
          revisionLean?.commitMessage,
        );
      }

      let commitSha = initialCommitSha;

      // Even when the caller asks to skip cleanup (spec-build and workspace
      // cursor-update already edited GitHub), we still run the completeness
      // gate on the merged tree: a green agent run can still ship thin/stub
      // pages. Only truly skip the cleanup round when the tree is clean.
      const builtTree = await this.repoService.readTreeAtSha(
        owner,
        repo,
        initialCommitSha,
      );
      const completenessReport = evaluateCompleteness(builtTree);

      // Scorecard: a single measurable "how complete does this build look"
      // number, logged + persisted per deploy so quality is trackable across
      // releases. Pure/cheap — no extra LLM or deploy cost.
      const scorecard = buildCompletenessScorecard(
        builtTree,
        project.initialPrompt ?? project.name ?? '',
      );
      this.logger.log(
        `[Completeness] project=${projectId} score=${scorecard.score}/100 ` +
          `archetype=${scorecard.archetype} routes=${scorecard.routesFound}/${scorecard.minPages} ` +
          `issues=${JSON.stringify(scorecard.counts)}`,
      );
      await this.deploymentModel
        .findByIdAndUpdate(deploymentMongoId, {
          $set: { 'metadata.completeness': scorecard },
        })
        .exec()
        .catch(() => undefined);

      const shouldSkipCleanup =
        skipCursorCleanup === true && completenessReport.ok;
      if (skipCursorCleanup === true && !completenessReport.ok) {
        this.logger.warn(
          `[DeployPipeline] project ${projectId}: cleanup was skipped by caller but ` +
            `completeness gate flagged ${completenessReport.stubPaths.length} stub/thin path(s) ` +
            `— running one cleanup round to enrich them.`,
        );
      }

      if (!shouldSkipCleanup) {
        // ── 1. CURSOR CLEANUP (attempt=0) ─────────────────────────────
        const completenessHint =
          formatCompletenessHintForCursor(completenessReport);

        await this.deploymentModel
          .findByIdAndUpdate(deploymentMongoId, {
            $set: {
              status: DeploymentStatus.REPAIRING,
              'metadata.repairAttempt': 0,
            },
          })
          .exec();

        const cleanup = await this.repoService.runExclusive(projectId, () =>
          this.cursorService.runRound({
            projectId,
            revisionId,
            owner,
            repo,
            baseSha: initialCommitSha,
            attempt: 0,
            kind: 'cleanup',
            revisionVersion,
            cursorUserTask,
            completenessHint: completenessHint || undefined,
          }),
        );

        if (cleanup.status === 'failed') {
          await failPipeline(
            new Error('Cursor cleanup round failed'),
            RevisionFailureReason.CURSOR_FAILED,
          );
          return;
        }

        commitSha =
          cleanup.status === 'merged' ? cleanup.mergedSha : initialCommitSha;
      }

      await this.revisionModel
        .findByIdAndUpdate(revisionId, { $set: { deployCommitSha: commitSha } })
        .exec();

      // ── 1.5. WAIT FOR SUPABASE (if provisioning) ─────────────────────────
      // If the project has a pending/provisioning Supabase instance, wait
      // for it to become ready before deploying. This gate ensures the
      // schema apply + env injection in step 2 always see a ready DB.
      {
        const preDeployProject = await this.projectModel
          .findById(projectId)
          .select('supabase')
          .lean();
        const sbStatus = preDeployProject?.supabase?.status;
        if (sbStatus === 'pending' || sbStatus === 'provisioning') {
          this.logger.log(
            `Waiting for Supabase to be ready for project ${projectId} (status: ${sbStatus})`,
          );
          await this.projectsService.ensureSupabaseReady(projectId, 'initial');
        }
      }

      // ── 2. VERCEL DEPLOY + REPAIR LOOP ────────────────────────────────────
      const MAX_REPAIR = this.cursorService.repairMaxAttempts; // 3
      let cursorRoundCount = 0;

      for (let attempt = 1; attempt <= MAX_REPAIR + 1; attempt++) {
        // Re-fetch project for latest Supabase/analytics/SEO config
        const freshProject = await this.projectModel.findById(projectId).exec();
        if (!freshProject) return;

        // Read canonical tree from GitHub at pinned SHA
        let files = await this.repoService.readTreeAtSha(
          owner,
          repo,
          commitSha,
        );

        // Enforce UI kit lock on the GitHub tree before Vercel deploy.
        // Cursor prompts instruct the agent not to touch kit files, but
        // if it misbehaves, this code-level gate restores canonical versions.
        const dsColors = freshProject.designSystemColors;
        const deployPalettes = palettesFromDesignSystem(dsColors);
        files = this.uiKitService.enforceKitLock(
          files,
          deployPalettes,
          resolveDesignStyle(freshProject.designStyleId, projectId),
        );

        // Apply Supabase schema (side-effect; best-effort)
        await this.applySupabaseSchemaForRevision(freshProject, files);

        const userSecretsEnv = this.buildUserAppSecretsBuildEnv(
          freshProject,
          files,
        );
        const supabaseEnv = this.buildSupabaseBuildEnv(freshProject);
        const analyticsEnv = this.buildAnalyticsBuildEnv(freshProject);
        const stripeEnv = this.buildStripeBuildEnv(freshProject);
        const buildEnv = mergeProjectDeployBuildEnv(
          userSecretsEnv,
          supabaseEnv,
          analyticsEnv,
          stripeEnv,
        );

        const seoBaseUrl = freshProject.customDomain
          ? `https://${freshProject.customDomain}`
          : typeof freshProject.previewUrl === 'string'
            ? stripVercelProtectionBypass(freshProject.previewUrl)
            : undefined;

        const seoInput = {
          projectName: freshProject.name,
          siteUrl: seoBaseUrl,
          config: freshProject.seo
            ? {
                title: freshProject.seo.title,
                description: freshProject.seo.description,
                ogImage: freshProject.seo.ogImage,
                twitterCard: freshProject.seo.twitterCard,
                robotsAllow: freshProject.seo.robotsAllow,
                canonical: freshProject.seo.canonical,
              }
            : undefined,
        };

        // Create Vercel deployment (applies preview-bridge, SEO, etc. internally)
        let vercelDeployment;
        try {
          vercelDeployment = await this.vercelService.createDeployment(
            projectId,
            files,
            framework,
            buildEnv,
            seoInput,
          );
        } catch (err) {
          await failPipeline(err, RevisionFailureReason.DEPLOY);
          return;
        }

        const deploymentUrl = stripVercelProtectionBypass(
          `https://${vercelDeployment.url}`,
        );
        const publicPreviewUrl = stripVercelProtectionBypass(
          iyonaVercelPublicPreviewUrl(projectId),
        );

        // Update deployment doc with real Vercel id
        await this.deploymentModel.findByIdAndUpdate(deploymentMongoId, {
          $set: {
            vercelDeploymentId: vercelDeployment.id,
            status: DeploymentStatus.BUILDING,
            deploymentUrl,
            previewUrl: publicPreviewUrl,
            commitSha,
            cursorRoundCount,
            'metadata.activeVercelDeploymentId': vercelDeployment.id,
            'metadata.clientPollingDeploymentId': pollingId,
          },
        });

        await this.revisionModel.findByIdAndUpdate(revisionId, {
          $set: {
            deploymentId: vercelDeployment.id,
            deploymentUrl,
            previewUrl: publicPreviewUrl,
            deployCommitSha: commitSha,
          },
        });

        freshProject.previewUrl = publicPreviewUrl;
        await freshProject.save();

        // Wait for Vercel outcome
        const VERCEL_WAIT_MS = 8 * 60 * 1000;
        const vercelOutcome = await this.waitForVercelOutcomeHybrid(
          deploymentMongoId,
          vercelDeployment.id,
          VERCEL_WAIT_MS,
        );

        if (vercelOutcome === 'READY') {
          // ── SUCCESS: assign alias + finalize ─────────────────────────────
          void this.finalizeDeploymentInBackground({
            projectId,
            revisionId,
            deploymentMongoId,
            vercelDeploymentId: vercelDeployment.id,
            clientPollingDeploymentId: pollingId,
            deploymentUrl,
            ownerUserId,
          });
          return;
        }

        // ── NOT A BUILD FAILURE ──────────────────────────────────────────────
        // TIMEOUT and CANCELED are NOT compile errors, so they must never enter
        // the Cursor repair loop — repairing a healthy-but-slow build with
        // truncated logs actively corrupts the tree and wastes agent rounds.
        if (vercelOutcome === 'TIMEOUT') {
          // We waited VERCEL_WAIT_MS and Vercel is still not terminal. Give the
          // build one more extended window before giving up.
          const extended = await this.waitForVercelOutcomeHybrid(
            deploymentMongoId,
            vercelDeployment.id,
            VERCEL_WAIT_MS,
          );
          if (extended === 'READY') {
            void this.finalizeDeploymentInBackground({
              projectId,
              revisionId,
              deploymentMongoId,
              vercelDeploymentId: vercelDeployment.id,
              clientPollingDeploymentId: pollingId,
              deploymentUrl,
              ownerUserId,
            });
            return;
          }
          if (extended === 'ERROR') {
            // A real build failure surfaced during the extension — fall through
            // to the repair path by NOT returning here.
          } else {
            // Still not terminal (or canceled). Cancel the Vercel build so it
            // stops consuming resources and fail with a distinct reason — no
            // repair.
            await this.vercelService
              .deleteDeployment(vercelDeployment.id)
              .catch(() => undefined);
            await this.markDeploymentFailed(
              deploymentMongoId,
              revisionId,
              projectId,
              'The deployment did not finish building in time. Please try deploying again.',
              extended === 'CANCELED' ? 'vercel_canceled' : 'vercel_timeout',
              false,
            );
            await this.revisionModel
              .findByIdAndUpdate(revisionId, {
                $set: {
                  failureReason:
                    extended === 'CANCELED'
                      ? RevisionFailureReason.VERCEL_CANCELED
                      : RevisionFailureReason.VERCEL_TIMEOUT,
                },
              })
              .exec();
            return;
          }
        } else if (vercelOutcome === 'CANCELED') {
          // A canceled build is terminal and not repairable.
          await this.markDeploymentFailed(
            deploymentMongoId,
            revisionId,
            projectId,
            'The deployment was canceled. Please try deploying again.',
            'vercel_canceled',
            false,
          );
          await this.revisionModel
            .findByIdAndUpdate(revisionId, {
              $set: { failureReason: RevisionFailureReason.VERCEL_CANCELED },
            })
            .exec();
          return;
        }

        // ── VERCEL BUILD FAILURE (ERROR) ─────────────────────────────────────
        if (attempt > MAX_REPAIR) {
          // All repair rounds exhausted
          const logs = await this.vercelService
            .getDeploymentLogs(vercelDeployment.id, 32)
            .catch(() => '');
          const { category, infraReason } = this.classifyBuildFailure(logs);
          const errors = this.parseBuildErrors(logs);
          const summary = this.buildErrorSummary(errors, category, infraReason);
          await this.markDeploymentFailed(
            deploymentMongoId,
            revisionId,
            projectId,
            summary,
            category,
            true,
          );
          await this.revisionModel
            .findByIdAndUpdate(revisionId, {
              $set: { failureReason: RevisionFailureReason.CURSOR_EXHAUSTED },
            })
            .exec();
          return;
        }

        // Fetch build logs to feed to Cursor
        const buildLogs = await this.vercelService
          .getDeploymentLogs(vercelDeployment.id, 32)
          .catch(() => '');

        this.logger.warn(
          `[DeployPipeline] Vercel build failed (attempt ${attempt}/${MAX_REPAIR}). Running Cursor repair.`,
        );

        // Mark as repairing so UI shows progress
        await this.deploymentModel.findByIdAndUpdate(deploymentMongoId, {
          $set: {
            status: DeploymentStatus.REPAIRING,
            'metadata.repairAttempt': attempt,
          },
        });

        // Cursor repair round
        const repair = await this.repoService.runExclusive(projectId, () =>
          this.cursorService.runRound({
            projectId,
            revisionId,
            owner,
            repo,
            baseSha: commitSha,
            attempt,
            kind: 'repair',
            vercelBuildLogTail: buildLogs,
            revisionVersion,
            cursorUserTask,
          }),
        );

        cursorRoundCount++;

        if (repair.status !== 'merged' && repair.status !== 'no_changes') {
          const summary = `Cursor repair attempt ${attempt} ended with status: ${repair.status}`;
          await this.markDeploymentFailed(
            deploymentMongoId,
            revisionId,
            projectId,
            summary,
            'cursor',
            false,
          );
          await this.revisionModel
            .findByIdAndUpdate(revisionId, {
              $set: { failureReason: RevisionFailureReason.CURSOR_EXHAUSTED },
            })
            .exec();
          return;
        }

        if (repair.status === 'merged') {
          commitSha = repair.mergedSha!;
          await this.revisionModel
            .findByIdAndUpdate(revisionId, {
              $set: { deployCommitSha: commitSha },
            })
            .exec();
        }
        // no_changes → commitSha stays the same; Vercel will re-use the same tree
      }
    } catch (err) {
      await failPipeline(err);
    }
  }

  /**
   * Poll current deployment progress by Vercel deployment id. Driven from the
   * Deployment collection so it works even after the process that started the
   * deploy has exited (which is the common case on serverless).
   */
  async getDeploymentProgress(
    projectId: string,
    vercelDeploymentId: string,
  ): Promise<DeployPreviewResponseDto> {
    const deployment = await this.deploymentModel
      .findOne({
        projectId,
        $or: [
          { vercelDeploymentId },
          { 'metadata.activeVercelDeploymentId': vercelDeploymentId },
          { 'metadata.clientPollingDeploymentId': vercelDeploymentId },
        ],
      })
      .exec();

    if (!deployment) {
      throw new NotFoundException(
        `Deployment ${vercelDeploymentId} not found for project ${projectId}`,
      );
    }

    // During QUEUED phase vercelDeploymentId is the pending_ placeholder;
    // activeVercelDeploymentId is set once the real Vercel deployment is created.
    const activeDeploymentId =
      deployment.metadata?.activeVercelDeploymentId ??
      (deployment.vercelDeploymentId?.startsWith('pending_')
        ? undefined
        : deployment.vercelDeploymentId);

    let failureReason: RevisionFailureReason | undefined;
    let validationErrors: RevisionValidationError[] | undefined;
    let errorMessage: string | undefined;
    let errorSummary: string | undefined;
    let failureCategory: string | undefined;
    let repairAttempt: number | undefined;

    const isTerminal =
      deployment.status === DeploymentStatus.ERROR ||
      deployment.status === DeploymentStatus.FAILED;

    if (isTerminal) {
      errorMessage = deployment.errorMessage;
      // Sanitize: never return raw Vercel deployment ID strings
      if (errorMessage && /dpl_[A-Za-z0-9]+/.test(errorMessage)) {
        errorMessage = undefined;
      }
      const revision = await this.revisionModel
        .findById(deployment.revisionId)
        .select('failureReason validationErrors')
        .exec();
      if (revision) {
        failureReason = revision.failureReason;
        validationErrors = revision.validationErrors;
      }
      errorSummary = deployment.metadata?.errorSummary;
      failureCategory = deployment.metadata?.failureCategory;
    }

    if (deployment.metadata?.repairAttempt != null) {
      repairAttempt = deployment.metadata.repairAttempt;
    }

    // Map ERROR → FAILED at the API boundary so clients see a clean terminal status
    const publicStatus =
      deployment.status === DeploymentStatus.ERROR
        ? DeploymentStatus.FAILED
        : deployment.status;

    const rawPreview = deployment.previewUrl || deployment.deploymentUrl || '';
    const rawDeployment = deployment.deploymentUrl || '';

    return {
      deploymentId: vercelDeploymentId,
      ...(activeDeploymentId &&
        activeDeploymentId !== vercelDeploymentId && {
          activeDeploymentId,
        }),
      previewUrl: withVercelProtectionBypass(rawPreview) ?? rawPreview,
      deploymentUrl: withVercelProtectionBypass(rawDeployment) ?? rawDeployment,
      status: publicStatus,
      ...(repairAttempt != null && { repairAttempt }),
      ...(errorSummary && { errorSummary }),
      ...(failureCategory && { failureCategory }),
      ...(errorMessage && { errorMessage }),
      ...(failureReason && { failureReason }),
      ...(validationErrors?.length && { validationErrors }),
    };
  }

  /**
   * Latest deployment snapshot for recovery polling after reconnect or timeout.
   * Uses `project.latestDeploymentId` when set, else the newest deployment doc.
   */
  async getCurrentDeploymentProgress(
    projectId: string,
  ): Promise<DeployPreviewResponseDto | null> {
    const project = await this.projectModel
      .findById(projectId)
      .select('latestDeploymentId')
      .lean()
      .exec();

    let deployment: Deployment | null = null;

    if (project?.latestDeploymentId) {
      deployment = await this.deploymentModel
        .findById(project.latestDeploymentId)
        .exec();
    }

    if (!deployment) {
      deployment = await this.deploymentModel
        .findOne({ projectId })
        .sort({ createdAt: -1 })
        .exec();
    }

    if (!deployment) {
      return null;
    }

    const pollingId =
      (typeof deployment.metadata?.clientPollingDeploymentId === 'string' &&
        deployment.metadata.clientPollingDeploymentId) ||
      deployment.vercelDeploymentId;

    if (!pollingId) return null;
    return this.getDeploymentProgress(projectId, pollingId);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // VERCEL WEBHOOK INTEGRATION
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Reap deployments stranded in a non-terminal state by a crashed/restarted
   * pipeline. The deploy pipeline is a fire-and-forget in-process task, so a
   * process exit leaves the Deployment doc frozen in QUEUED/BUILDING/REPAIRING
   * — which blocks all future deploys, cursor edits, and file saves for the
   * project. Runs every 5 minutes.
   *
   * For a deployment that reached Vercel we re-resolve its real state (a build
   * that quietly finished while we were dead is recovered as READY/FAILED); one
   * still genuinely building is left alone. A deployment that never reached
   * Vercel (no id) past the window is marked FAILED — the pre-Vercel work that
   * would have created it is gone.
   */
  @Cron('*/5 * * * *', { name: 'reap-stale-deployments' })
  async reapStaleDeployments(): Promise<void> {
    const staleMsRaw = Number(process.env.DEPLOYMENT_STALE_MS);
    const STALE_MS =
      Number.isFinite(staleMsRaw) && staleMsRaw > 0
        ? staleMsRaw
        : 60 * 60 * 1000; // 60 min — safely past agent rounds + Vercel wait
    const cutoff = new Date(Date.now() - STALE_MS);

    const stale = await this.deploymentModel
      .find({
        status: {
          $in: [
            DeploymentStatus.QUEUED,
            DeploymentStatus.BUILDING,
            DeploymentStatus.REPAIRING,
          ],
        },
        updatedAt: { $lt: cutoff },
      })
      .select('_id vercelDeploymentId')
      .lean()
      .exec();
    if (stale.length === 0) return;

    this.logger.warn(
      `[DeploymentReaper] Resolving ${stale.length} stale deployment(s) past ${STALE_MS}ms`,
    );

    for (const dep of stale) {
      try {
        if (dep.vercelDeploymentId) {
          const status = await this.vercelService.getDeploymentStatus(
            dep.vercelDeploymentId,
          );
          if (status.readyState === 'READY') {
            await this.deploymentModel.updateOne(
              { _id: dep._id, status: { $ne: DeploymentStatus.READY } },
              {
                $set: {
                  status: DeploymentStatus.READY,
                  ...(status.url
                    ? { deploymentUrl: `https://${status.url}` }
                    : {}),
                  readyAt: new Date(),
                },
              },
            );
            continue;
          }
          if (
            status.readyState === 'ERROR' ||
            status.readyState === 'CANCELED'
          ) {
            await this.markDeploymentReaped(String(dep._id));
            continue;
          }
          // Still BUILDING/QUEUED on Vercel's side — genuinely alive, leave it.
          continue;
        }
        // No Vercel deployment was ever created — the in-process pre-Vercel
        // work is dead; fail it so the project unblocks.
        await this.markDeploymentReaped(String(dep._id));
      } catch (err) {
        this.logger.error(
          `[DeploymentReaper] Failed to resolve ${String(dep._id)}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  private async markDeploymentReaped(deploymentId: string): Promise<void> {
    await this.deploymentModel.updateOne(
      {
        _id: deploymentId,
        status: {
          $in: [
            DeploymentStatus.QUEUED,
            DeploymentStatus.BUILDING,
            DeploymentStatus.REPAIRING,
          ],
        },
      },
      {
        $set: {
          status: DeploymentStatus.FAILED,
          failedAt: new Date(),
          errorMessage:
            'The deployment stopped responding and was cancelled by the system.',
        },
      },
    );
  }

  /**
   * Called by the Vercel webhook controller when Vercel pushes a deployment
   * lifecycle event. Updates the Deployment document so the background
   * `waitForVercelOutcomeHybrid` loop sees it immediately.
   *
   * Supported event types:
   *   deployment.succeeded / deployment.ready → mark READY
   *   deployment.error                        → mark ERROR
   *   deployment.canceled                     → mark CANCELED
   */
  async notifyVercelDeploymentEvent(payload: {
    type: string;
    vercelDeploymentId: string;
    vercelDeploymentUrl?: string;
  }): Promise<void> {
    const { type, vercelDeploymentId, vercelDeploymentUrl } = payload;

    let newStatus: DeploymentStatus | null = null;
    if (type === 'deployment.succeeded' || type === 'deployment.ready') {
      newStatus = DeploymentStatus.READY;
    } else if (type === 'deployment.error') {
      newStatus = DeploymentStatus.ERROR;
    } else if (type === 'deployment.canceled') {
      newStatus = DeploymentStatus.CANCELED;
    }

    if (!newStatus) {
      this.logger.debug(`[VercelWebhook] Ignoring event type: ${type}`);
      return;
    }

    const update: Record<string, unknown> = { status: newStatus };
    if (vercelDeploymentUrl && newStatus === DeploymentStatus.READY) {
      update.deploymentUrl = `https://${vercelDeploymentUrl}`;
    }

    // Only transition from a non-terminal state. Without this precondition a
    // late/replayed/out-of-order webhook (e.g. a `deployment.succeeded` that
    // arrives after we already recorded FAILED) would flip a terminal record
    // back and forth. Terminal states (READY/ERROR/CANCELED/FAILED) are final.
    const result = await this.deploymentModel
      .findOneAndUpdate(
        {
          $or: [
            { vercelDeploymentId },
            { 'metadata.activeVercelDeploymentId': vercelDeploymentId },
          ],
          status: {
            $in: [
              DeploymentStatus.QUEUED,
              DeploymentStatus.BUILDING,
              DeploymentStatus.REPAIRING,
            ],
          },
        },
        { $set: update },
        { new: true },
      )
      .exec();

    if (result) {
      this.logger.log(
        `[VercelWebhook] Updated deployment ${result._id} → ${newStatus} (vercel: ${vercelDeploymentId})`,
      );
    } else {
      // Either no matching deployment, or it is already in a terminal state —
      // in both cases there is nothing safe to update.
      this.logger.warn(
        `[VercelWebhook] No non-terminal deployment for vercelDeploymentId ${vercelDeploymentId} — event ignored`,
      );
    }
  }

  /**
   * Hybrid wait: poll MongoDB for status changes (webhook path is fast) and
   * fall back to direct Vercel API polling every 30 seconds as a safety net.
   * Returns the final Vercel outcome: 'READY' | 'ERROR' | 'CANCELED' | 'TIMEOUT'.
   */
  private async waitForVercelOutcomeHybrid(
    deploymentMongoId: string,
    vercelDeploymentId: string,
    timeoutMs: number,
  ): Promise<'READY' | 'ERROR' | 'CANCELED' | 'TIMEOUT'> {
    const POLL_INTERVAL_MS = 4_000; // check MongoDB every 4s
    const VERCEL_FALLBACK_MS = 30_000; // query Vercel API every 30s as backup
    const deadline = Date.now() + timeoutMs;
    let lastVercelCheck = Date.now();

    while (Date.now() < deadline) {
      // 1. Check our MongoDB Deployment document (fast, updated by webhook).
      const doc = await this.deploymentModel
        .findById(deploymentMongoId)
        .select('status vercelDeploymentId')
        .lean()
        .exec();

      if (doc) {
        if (doc.status === DeploymentStatus.READY) return 'READY';
        if (doc.status === DeploymentStatus.ERROR) return 'ERROR';
        if (doc.status === DeploymentStatus.FAILED) return 'ERROR';
        if (doc.status === DeploymentStatus.CANCELED) return 'CANCELED';
      }

      // 2. Periodic Vercel API fallback — in case webhook didn't arrive.
      if (Date.now() - lastVercelCheck >= VERCEL_FALLBACK_MS) {
        lastVercelCheck = Date.now();
        try {
          const vercelStatus =
            await this.vercelService.getDeploymentStatus(vercelDeploymentId);
          if (vercelStatus.readyState === 'READY') {
            // Webhook missed — update MongoDB now so the caller sees READY.
            await this.deploymentModel
              .findByIdAndUpdate(deploymentMongoId, {
                $set: { status: DeploymentStatus.READY },
              })
              .exec()
              .catch(() => undefined);
            return 'READY';
          }
          if (
            vercelStatus.readyState === 'ERROR' ||
            vercelStatus.readyState === 'CANCELED'
          ) {
            const outcome =
              vercelStatus.readyState === 'ERROR' ? 'ERROR' : 'CANCELED';
            await this.deploymentModel
              .findByIdAndUpdate(deploymentMongoId, {
                $set: {
                  status:
                    outcome === 'ERROR'
                      ? DeploymentStatus.ERROR
                      : DeploymentStatus.CANCELED,
                },
              })
              .exec()
              .catch(() => undefined);
            return outcome;
          }
        } catch (vercelErr) {
          this.logger.warn(
            `[HybridWait] Vercel fallback poll failed for ${vercelDeploymentId}: ${
              vercelErr instanceof Error ? vercelErr.message : vercelErr
            }`,
          );
        }
      }

      await new Promise<void>((resolve) =>
        setTimeout(resolve, POLL_INTERVAL_MS),
      );
    }

    return 'TIMEOUT';
  }

  /**
   * Return the full source tree for the latest revision. Since every project
   * is a self-contained repository, this is just the AI-produced file map.
   */
  async getLatestRevisionFullSource(
    projectId: string,
  ): Promise<Record<string, string> | null> {
    return this.getLatestRevisionFiles(projectId);
  }

  /**
   * Parse TypeScript / build error lines out of raw Vercel log output.
   *
   * Matches lines like:
   *   src/components/Foo.tsx(12,5): error TS2339: Property 'x' does not exist…
   *   error TS1005: '>' expected.
   *
   * Also captures "Command … exited with N" so the AI sees the exit summary.
   */
  private parseBuildErrors(logs: string): string[] {
    if (!logs) return [];
    const ansiRe =
      /[\u001b\u009b][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[a-zA-Z\d]*)*)?\u0007)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g;
    const timestampRe = /^\s*(?:\[\d{2}:\d{2}:\d{2}\.\d{3}\]\s*)?/;
    const tsErrorRe =
      /(?:^|[\s:])(?:\.\/)?(?:src|app|pages|components|lib|utils)\/[^\s]+\.(?:ts|tsx|js|jsx)(?:(?:\(\d+,\d+\))|(?::\d+:\d+))?.*error\s+TS\d+:/i;
    const genericTsErrorRe = /(?:^|\s)error\s+TS\d+:/i;
    const tsSummaryRe =
      /\b\d+\s+TypeScript\s+errors?\s+in\s+(?:\.\/)?(?:src|app|pages|components|lib|utils)\/[^\s]+\.(?:ts|tsx|js|jsx)\b/i;
    const exitRe = /Command\s+".+"\s+exited\s+with\s+\d+/i;

    const lines = logs
      .split(/\r?\n/)
      .map((line) => line.replace(ansiRe, '').replace(timestampRe, '').trim())
      .filter(Boolean);

    return [
      ...new Set(
        lines.filter(
          (line) =>
            tsErrorRe.test(line) ||
            genericTsErrorRe.test(line) ||
            tsSummaryRe.test(line) ||
            exitRe.test(line),
        ),
      ),
    ];
  }

  /**
   * Classify build log output into infrastructure vs. code failures.
   * Infrastructure failures (OOM, missing env, npm install fail) cannot
   * be fixed by AI — we skip the repair loop for them.
   */
  private classifyBuildFailure(logs: string): {
    category: 'ts' | 'infra' | 'unknown';
    infraReason?: string;
  } {
    if (!logs) return { category: 'unknown' };

    const infraPatterns: Array<[RegExp, string]> = [
      [/npm\s+(?:error|ERR!)\s+code\s+\S+/i, 'npm install failed'],
      [/Cannot find module\s+['"](?!@\/)(?!\.)/i, 'missing npm dependency'],
      [
        /(?:out of memory|JavaScript heap out of memory|Killed)/i,
        'out of memory',
      ],
      [/(?:ENOMEM|SIGKILL)/i, 'process killed'],
      [
        /(?:failed to resolve|Could not resolve)\s+['"](?!@\/)(?!\.)/i,
        'missing npm dependency',
      ],
      [
        /error:\s+(?:environment variable|env var)/i,
        'missing environment variable',
      ],
      [/failed to create alias/i, 'alias creation failed'],
    ];

    for (const [pattern, reason] of infraPatterns) {
      if (pattern.test(logs)) {
        return { category: 'infra', infraReason: reason };
      }
    }

    // If there are TypeScript errors, it's a code failure. Exit-code lines are
    // included in repair prompts, but are not sufficient by themselves.
    const hasTypeScriptErrors =
      this.parseBuildErrors(logs).some(
        (line) =>
          /error\s+TS\d+:/i.test(line) ||
          /\bTypeScript\s+errors?\b/i.test(line),
      ) || /\bTypeScript\s+errors?\b/i.test(logs);
    if (hasTypeScriptErrors) {
      return { category: 'ts' };
    }

    return { category: 'unknown' };
  }

  /**
   * Generate a human-readable error summary from build error lines.
   * Used to populate metadata.errorSummary on failed deployments.
   * Never includes raw Vercel deployment IDs.
   */
  private buildErrorSummary(
    errors: string[],
    category: 'ts' | 'infra' | 'unknown',
    infraReason?: string,
  ): string {
    if (category === 'infra') {
      return `Build environment issue: ${infraReason || 'infrastructure failure'}. Try deploying again.`;
    }

    if (errors.length === 0) {
      return 'Build failed with no parseable errors. Check the build logs for details.';
    }

    // Count unique files
    const filePattern = /^(src\/[^\s(]+)/;
    const filesWithErrors = new Set<string>();
    for (const e of errors) {
      const m = filePattern.exec(e);
      if (m) filesWithErrors.add(m[1]);
    }

    const fileList =
      filesWithErrors.size > 0
        ? `in ${[...filesWithErrors].slice(0, 3).join(', ')}${filesWithErrors.size > 3 ? ` (+${filesWithErrors.size - 3} more)` : ''}`
        : '';

    return `${errors.length} TypeScript error${errors.length !== 1 ? 's' : ''} ${fileList}`.trim();
  }

  /**
   * Assign alias + persist READY state for a Vercel deployment that succeeded.
   * Called by `runDeployPipeline` after `waitForVercelOutcomeHybrid` returns READY.
   * Errors are caught and logged — they never propagate (alias failure is non-fatal).
   */
  private async finalizeDeploymentInBackground(payload: {
    projectId: string;
    revisionId: string;
    deploymentMongoId: string;
    vercelDeploymentId: string;
    clientPollingDeploymentId: string;
    deploymentUrl: string;
    ownerUserId: string;
  }): Promise<void> {
    const {
      projectId,
      revisionId,
      deploymentMongoId,
      vercelDeploymentId,
      clientPollingDeploymentId,
      ownerUserId,
    } = payload;

    try {
      // Assign stable alias — non-fatal if it fails
      const aliasDomain = process.env.PREVIEW_ALIAS_DOMAIN || 'jarvis.site';
      const targetAlias = `p-${projectId}.${aliasDomain}`;

      const publicVercelPreview = stripVercelProtectionBypass(
        iyonaVercelPublicPreviewUrl(projectId),
      );

      // Prefer stable project hostname on *.vercel.app (not the per-deployment URL).
      let previewUrl = publicVercelPreview;
      let persistedAlias: string | null = null;
      try {
        const assigned = await this.vercelService.assignAlias(
          vercelDeploymentId,
          targetAlias,
        );
        previewUrl = stripVercelProtectionBypass(assigned);
        persistedAlias = targetAlias;
      } catch (aliasErr) {
        this.logger.warn(
          `Alias assignment failed for ${vercelDeploymentId}: ${(aliasErr as Error).message}. Using stable Vercel project preview URL.`,
        );
      }

      await this.deploymentModel
        .findByIdAndUpdate(deploymentMongoId, {
          $set: {
            status: DeploymentStatus.READY,
            previewUrl,
            alias: persistedAlias,
            readyAt: new Date(),
          },
        })
        .exec();

      await this.revisionModel
        .findByIdAndUpdate(revisionId, {
          $set: { status: RevisionStatus.DEPLOYED, previewUrl },
        })
        .exec();

      try {
        await this.projectsService.finalizeDeploymentWorkflowFromBackend(
          projectId,
          ownerUserId,
          clientPollingDeploymentId,
          previewUrl,
        );
      } catch (finalizeErr) {
        this.logger.error(
          `finalizeDeploymentWorkflowFromBackend failed for project ${projectId}: ${
            finalizeErr instanceof Error ? finalizeErr.message : finalizeErr
          }`,
        );
      }

      this.logger.log(`Deployed revision ${revisionId} to ${previewUrl}`);
    } catch (error) {
      const errMsg: string =
        error instanceof Error ? error.message : String(error);

      this.logger.error(
        `[Finalize] Alias/finalization failed for deployment ${vercelDeploymentId}: ${errMsg}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  /**
   * Write terminal FAILED state to Deployment, Revision, and Project records.
   */
  private async markDeploymentFailed(
    deploymentMongoId: string,
    revisionId: string,
    projectId: string,
    errorSummary: string,
    failureCategory: string,
    isBuildError: boolean,
  ): Promise<void> {
    await this.deploymentModel
      .findByIdAndUpdate(deploymentMongoId, {
        $set: {
          status: DeploymentStatus.FAILED,
          errorMessage: errorSummary,
          failedAt: new Date(),
          'metadata.failureCategory': failureCategory,
          'metadata.errorSummary': errorSummary,
        },
      })
      .exec()
      .catch(() => undefined);

    const bgFailureReason = isBuildError
      ? RevisionFailureReason.BUILD
      : RevisionFailureReason.DEPLOY;

    await this.revisionModel
      .findByIdAndUpdate(revisionId, {
        $set: {
          status: RevisionStatus.FAILED,
          errorMessage: errorSummary,
          failureReason: bgFailureReason,
        },
      })
      .exec()
      .catch(() => undefined);

    await this.projectModel
      .findByIdAndUpdate(projectId, {
        $set: { status: ProjectStatus.FAILED },
      })
      .exec()
      .catch(() => undefined);
  }

  /**
   * Get all revisions for a project
   */
  async getRevisionsByProject(projectId: string): Promise<RevisionDto[]> {
    const revisions = await this.revisionModel
      .find({ projectId })
      .sort({ version: -1 })
      .exec();

    return revisions.map((r) => this.revisionDocumentToDto(r));
  }

  /**
   * Map a stored revision document to API DTO, appending the Vercel deployment
   * protection bypass query param on preview URLs when configured.
   */
  private revisionDocumentToDto(revision: {
    toObject(): Record<string, unknown>;
  }): RevisionDto {
    const raw = revision.toObject();
    let previewUrl: unknown = raw.previewUrl;
    let deploymentUrl: unknown = raw.deploymentUrl;
    if (typeof previewUrl === 'string' && previewUrl) {
      previewUrl = withVercelProtectionBypass(previewUrl) ?? previewUrl;
    }
    if (typeof deploymentUrl === 'string' && deploymentUrl) {
      deploymentUrl =
        withVercelProtectionBypass(deploymentUrl) ?? deploymentUrl;
    }
    return plainToInstance(RevisionDto, {
      ...raw,
      previewUrl,
      deploymentUrl,
    });
  }

  /**
   * Get a specific revision. The caller MUST pass the projectId from the
   * URL so we can confirm the revision actually belongs to it; otherwise
   * any authenticated user could read any other user's revision metadata
   * by guessing/iterating revisionIds (the controller already gates by
   * the project's accessRole, which is useless if the revision is from
   * a different project).
   */
  async getRevision(
    projectId: string,
    revisionId: string,
  ): Promise<RevisionDto> {
    const revision = await this.revisionModel.findById(revisionId).exec();
    if (!revision) {
      throw new NotFoundException(`Revision ${revisionId} not found`);
    }
    if (revision.projectId.toString() !== projectId) {
      // Use NotFound (not BadRequest) so we don't confirm "this id exists
      // but you can't see it" — same posture as object-storage IDOR
      // hardening.
      throw new NotFoundException(`Revision ${revisionId} not found`);
    }

    return this.revisionDocumentToDto(revision);
  }

  /**
   * Get the latest revision for a project
   */
  async getLatestRevision(projectId: string): Promise<RevisionDto | null> {
    const revision = await this.revisionModel
      .findOne({ projectId })
      .sort({ version: -1 })
      .exec();

    if (!revision) {
      return null;
    }

    return this.revisionDocumentToDto(revision);
  }

  /**
   * Get files from a revision
   */
  async getRevisionFiles(
    projectId: string,
    revisionId: string,
  ): Promise<Record<string, string>> {
    const revision = await this.revisionModel.findById(revisionId).exec();
    if (!revision) {
      throw new NotFoundException(`Revision ${revisionId} not found`);
    }

    if (revision.projectId.toString() !== projectId) {
      throw new BadRequestException('Revision does not belong to this project');
    }

    return this.s3Service.downloadRevision(projectId, revisionId);
  }

  /**
   * Get files from the latest revision for a project
   */
  async getLatestRevisionFiles(
    projectId: string,
  ): Promise<Record<string, string> | null> {
    try {
      const revision = await this.revisionModel
        .findOne({ projectId })
        .sort({ version: -1 })
        .exec();

      if (!revision) {
        this.logger.warn(`No revision found for project ${projectId}`);
        return null;
      }

      this.logger.log(
        `Found revision ${revision._id} (version ${revision.version}) for project ${projectId} with status: ${revision.status}`,
      );

      // GitHub-canonical path: revision has a commit SHA (new pipeline)
      if (revision.initialCommitSha) {
        const project = await this.projectModel
          .findById(projectId)
          .select('jarvisGithub')
          .lean()
          .exec();

        if (project?.jarvisGithub?.owner && project.jarvisGithub.repo) {
          const { owner, repo } = project.jarvisGithub;
          const sha = revision.deployCommitSha ?? revision.initialCommitSha;
          this.logger.log(
            `Fetching files from GitHub ${owner}/${repo}@${sha} for revision ${revision._id}`,
          );
          const files = await this.repoService.readTreeAtSha(owner, repo, sha);
          if (files && Object.keys(files).length > 0) return files;
        }
      }

      // Legacy S3 fallback (pre-GitHub-canonical revisions)
      if (!revision.s3Key) {
        this.logger.warn(
          `Revision ${revision._id} (v${revision.version}) for project ${projectId} has no S3 key and no GitHub SHA`,
        );
        return null;
      }

      this.logger.log(
        `Fetching files from S3 for revision ${revision._id} (s3Key: ${revision.s3Key})`,
      );

      const files = await this.s3Service.downloadRevision(
        projectId,
        revision._id.toString(),
      );

      if (!files || Object.keys(files).length === 0) {
        this.logger.warn(
          `Revision ${revision._id} for project ${projectId} has no files in S3`,
        );
        return null;
      }

      this.logger.log(
        `Retrieved ${Object.keys(files).length} files from latest revision ${revision._id} (version ${revision.version}) for project ${projectId}`,
      );

      return files;
    } catch (error) {
      this.logger.error(
        `Failed to get latest revision files for project ${projectId}: ${error.message}`,
        error.stack,
      );
      // Return null instead of throwing to allow frontend to handle gracefully
      return null;
    }
  }

  /**
   * Get the stable preview URL for a project
   */
  async getPreviewUrl(projectId: string): Promise<string | null> {
    const project = await this.projectModel.findById(projectId).exec();
    if (!project) {
      throw new NotFoundException(`Project ${projectId} not found`);
    }

    const embeddedPreview = project.deployment?.previewUrl;

    const readyDeployment = await this.deploymentModel
      .findOne({ projectId, status: DeploymentStatus.READY })
      .sort({ readyAt: -1, updatedAt: -1 })
      .lean()
      .exec();

    const deployedRevision = await this.revisionModel
      .findOne({ projectId, status: RevisionStatus.DEPLOYED })
      .sort({ version: -1 })
      .lean()
      .exec();

    const raw = pickFirstPreviewUrlRaw({
      projectPreviewUrl: project.previewUrl,
      embeddedWorkflowPreviewUrl: embeddedPreview,
      deploymentDocumentPreviewUrl: readyDeployment?.previewUrl,
      deploymentDocumentDeploymentUrl: readyDeployment?.deploymentUrl,
      revisionPreviewUrl: deployedRevision?.previewUrl,
      revisionDeploymentUrl: deployedRevision?.deploymentUrl,
    });

    return finalizePreviewUrlForApi(raw);
  }

  /**
   * Create revision and deploy in one step (convenience method)
   */
  async createAndDeploy(
    projectId: string,
    createRevisionDto: CreateRevisionDto,
    framework: string = 'vite',
  ): Promise<DeployPreviewResponseDto> {
    // Create revision
    const revision = await this.createRevision(projectId, createRevisionDto);

    // Deploy it
    return this.deployPreview(projectId, revision._id, framework);
  }

  /**
   * Validate the incoming file payload is within safe limits. Rejects
   * oversized revisions early, before we burn S3/Mongo work on them.
   */
  private assertRevisionWithinLimits(files: Record<string, string>): void {
    if (!files || typeof files !== 'object') {
      throw new BadRequestException('Revision files payload is required');
    }

    const fileNames = Object.keys(files);
    if (fileNames.length === 0) {
      throw new BadRequestException('Revision must contain at least one file');
    }

    if (fileNames.length > RevisionsService.MAX_FILES_PER_REVISION) {
      throw new BadRequestException(
        `Revision exceeds file count limit (${fileNames.length} > ${RevisionsService.MAX_FILES_PER_REVISION})`,
      );
    }

    let totalBytes = 0;
    for (const name of fileNames) {
      // Path-traversal guard. AI-generated maps occasionally include
      // `../foo` or absolute paths; normalizing here means the S3 key
      // and downstream Vercel deploy can never escape the per-revision
      // prefix even if a future caller forgets to validate.
      try {
        assertSafeRelativePath(name);
      } catch (err) {
        throw new BadRequestException(
          err instanceof Error ? err.message : 'Invalid file path',
        );
      }

      const content = files[name] ?? '';
      const bytes = Buffer.byteLength(content, 'utf8');

      if (bytes > RevisionsService.MAX_BYTES_PER_FILE) {
        throw new BadRequestException(
          `File ${name} exceeds per-file size limit (${bytes} > ${RevisionsService.MAX_BYTES_PER_FILE} bytes)`,
        );
      }

      totalBytes += bytes;
      if (totalBytes > RevisionsService.MAX_TOTAL_BYTES_PER_REVISION) {
        throw new BadRequestException(
          `Revision exceeds total size limit (> ${RevisionsService.MAX_TOTAL_BYTES_PER_REVISION} bytes)`,
        );
      }
    }
  }
}
