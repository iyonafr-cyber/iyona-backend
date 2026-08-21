/**
 * Smoke test for the Spec→Cursor build path (prototype).
 *
 * Boots the FULL Nest DI container (validates every wiring: AiService,
 * CursorService, RepoService, RevisionsService, SpecBuildService) using the
 * same .env the app loads via ConfigModule. Secrets are read from the
 * environment and never printed.
 *
 * Stages (safe by default):
 *   (default) spec-only — runs ONLY AiService.generateBuildSpec and prints the
 *             brief. Mutates nothing except a small `build_spec` credit charge.
 *   --full    end-to-end — seeds the repo, runs the Cursor full build (up to
 *             ~15 min), mints a revision, and triggers a Vercel deploy. This
 *             MUTATES the chosen project's `main` branch and deploys. Requires
 *             an explicit --id=<id>.
 *
 * Usage:
 *   npx ts-node -r tsconfig-paths/register scripts/spec-build-smoke.ts
 *   npx ts-node -r tsconfig-paths/register scripts/spec-build-smoke.ts --id=<id> --idea="a habit tracker"
 *   npx ts-node -r tsconfig-paths/register scripts/spec-build-smoke.ts --full --id=<id> --idea="a habit tracker"
 *
 * Notes:
 *   - --list just prints candidate projects (those with a Jarvis GitHub repo).
 *   - For --full the project's repo `main` is overwritten with the seed + build,
 *     so use a throwaway/test project, not a customer's.
 */
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { getModelToken } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { AppModule } from '../src/app.module';
import { AiService } from '../src/ai/ai.service';
import { SpecBuildService } from '../src/spec-build/spec-build.service';
import { UserProject } from '../src/projects/entities/user-project.entity';

interface Args {
  full: boolean;
  list: boolean;
  projectId?: string;
  idea: string;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  let full = false;
  let list = false;
  let projectId: string | undefined;
  let idea =
    'a clean personal habit tracker with streaks and a weekly dashboard';
  for (const a of argv) {
    // Note: use --id (not --project) — ts-node/tsconfig-paths reserves --project.
    if (a === '--full') full = true;
    else if (a === '--list') list = true;
    else if (a.startsWith('--id=')) projectId = a.slice('--id='.length);
    else if (a.startsWith('--idea=')) idea = a.slice('--idea='.length);
  }
  return { full, list, projectId, idea };
}

function ms(start: number): string {
  return `${((Date.now() - start) / 1000).toFixed(1)}s`;
}

async function main() {
  const args = parseArgs();

  // The service is flag-gated; enable it for this process only.
  if (process.env.SPEC_BUILD_ENABLED !== 'true') {
    process.env.SPEC_BUILD_ENABLED = 'true';
    console.log('• SPEC_BUILD_ENABLED was not set — enabled for this run.');
  }
  if (!process.env.CURSOR_API_KEY) {
    console.warn(
      '⚠ CURSOR_API_KEY is not set — --full will fail at the build step.',
    );
  }

  console.log('• Booting Nest DI container (validates all spec-build wiring)…');
  const bootStart = Date.now();
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  console.log(
    `✓ Container up in ${ms(bootStart)} — DI for SpecBuildService resolved.`,
  );

  try {
    const projectModel = app.get<Model<UserProject>>(
      getModelToken(UserProject.name),
    );
    const aiService = app.get(AiService);
    const specBuild = app.get(SpecBuildService);

    // ── Resolve target project (must have a Jarvis GitHub repo) ──────────
    const candidates = await projectModel
      .find({ jarvisGithub: { $ne: null }, deletedAt: null })
      .select('_id name userId jarvisGithub')
      .sort({ updatedAt: -1 })
      .limit(15)
      .lean()
      .exec();

    if (args.list || candidates.length === 0) {
      console.log(
        `\nCandidate projects with a Jarvis GitHub repo (${candidates.length}):`,
      );
      for (const p of candidates) {
        const gh = (p as any).jarvisGithub;
        console.log(
          `  - ${String(p._id)}  "${(p as any).name ?? ''}"  ${gh?.owner}/${gh?.repo}`,
        );
      }
      if (candidates.length === 0)
        console.log('  (none — create/generate a project first.)');
      return;
    }

    const project = args.projectId
      ? (candidates.find((p) => String(p._id) === args.projectId) ??
        (await projectModel.findById(args.projectId).lean().exec()))
      : candidates[0];

    if (!project) {
      console.error(`✗ Project ${args.projectId} not found or has no repo.`);
      process.exitCode = 1;
      return;
    }
    const gh = (project as any).jarvisGithub;
    if (!gh?.owner || !gh?.repo) {
      console.error(
        `✗ Project ${String(project._id)} has no jarvisGithub repo.`,
      );
      process.exitCode = 1;
      return;
    }
    const userId = String((project as any).userId);
    console.log(
      `\n• Target: ${String(project._id)} "${(project as any).name ?? ''}" → ${gh.owner}/${gh.repo}`,
    );
    console.log(`• Idea:   ${args.idea}`);
    const ctx = { userId, projectId: String(project._id) };

    if (!args.full) {
      // ── STAGE A: spec-only (safe) ──────────────────────────────────────
      console.log(
        '\n=== STAGE: spec-only (brain) — pass --full for end-to-end ===',
      );
      const t = Date.now();
      const { brief, estimate, loadingFiles, meta } =
        await aiService.generateBuildSpec(args.idea, { theme: 'auto' }, ctx);
      console.log(
        `✓ Build brief generated in ${ms(t)} — ${brief.length} chars, credits=${meta.creditsCharged}`,
      );
      console.log(
        '\n──────── ESTIMATE (LLM guess — not real metering) ────────',
      );
      console.log(
        `  build time: ~${estimate.buildSeconds}s   tokens: ~${estimate.tokens}   files: ~${estimate.fileCount}`,
      );
      console.log('\n──────── LOADING-SCREEN FILES (illustrative) ────────');
      console.log(
        loadingFiles.length
          ? loadingFiles.map((f) => `  • ${f}`).join('\n')
          : '  (none returned)',
      );
      console.log('\n──────── BUILD BRIEF (first 1200 chars) ────────');
      console.log(brief.slice(0, 1200));
      console.log('──────── …(truncated) ────────');
      console.log(
        '\nNext: re-run with --full --id=<id> to seed, build, and deploy.',
      );
      return;
    }

    // ── STAGE B: full end-to-end (mutating) ──────────────────────────────
    if (!args.projectId) {
      console.error(
        '✗ Refusing to run --full without an explicit --id=<id> (it overwrites main + deploys).',
      );
      process.exitCode = 1;
      return;
    }
    console.log(
      '\n=== STAGE: FULL end-to-end (seeds repo, Cursor build, deploy) ===',
    );
    console.log(
      '  This overwrites the repo main branch and triggers a real deploy.',
    );
    const t = Date.now();
    const result = await specBuild.runSpecBuild({
      projectId: String(project._id),
      owner: gh.owner,
      repo: gh.repo,
      projectIdea: args.idea,
      answers: { theme: 'auto' },
      ctx,
    });
    console.log(`\n✓ runSpecBuild finished in ${ms(t)} (actual wall-clock)`);
    console.log(`  status:        ${result.status}`);
    console.log(
      `  est vs actual: ~${result.estimate.buildSeconds}s estimated → ${ms(t)} actual`,
    );
    console.log(`  est tokens:    ~${result.estimate.tokens}`);
    console.log(`  loadingFiles:  ${result.loadingFiles.length}`);
    console.log(`  mergedSha:     ${result.mergedSha ?? '(none)'}`);
    console.log(`  prUrl:         ${result.prUrl ?? '(none)'}`);
    console.log(`  revisionId:    ${result.revisionId ?? '(none)'}`);
    console.log(`  deploymentId:  ${result.deploymentId ?? '(none)'}`);
    console.log(`  specChars:     ${result.spec.length}`);
    console.log(
      '\nDeploy runs in the background — poll the deployment for the Vercel URL.',
    );
  } finally {
    await app.close();
  }
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((err) => {
    console.error(
      '\n✗ Smoke test failed:',
      err instanceof Error ? err.message : err,
    );
    process.exit(1);
  });
