/**
 * Smoke test for the unified workspace-chat round
 * (`CursorService.runStandaloneUserPromptRound`, the path behind
 * POST /projects/:projectId/workspace/cursor-update).
 *
 * The point of this script is to verify the routing decision the *agent* makes:
 *   - a QUESTION  → status `no_changes` + `agentMessage` (the answer), no PR
 *   - a CHANGE    → status `merged` + a PR that was merged into main
 *
 * WARNING: this is the real chat path, so a change request WILL merge to main of
 * the target repo. Point it at a throwaway repo.
 *
 * Usage:
 *   npx ts-node -r tsconfig-paths/register scripts/cursor-chat-round-smoke.ts --repo=owner/name --q="Does this app have an admin feature?"
 *   npx ts-node -r tsconfig-paths/register scripts/cursor-chat-round-smoke.ts --id=<projectId> --q="..."
 *   ... --expect=question   # exit non-zero if the agent changed code
 *   ... --expect=change     # exit non-zero if the agent only talked
 */
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { getModelToken } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { AppModule } from '../src/app.module';
import { CursorService } from '../src/cursor/cursor.service';
import { UserProject } from '../src/projects/entities/user-project.entity';

interface Args {
  projectId?: string;
  repo?: string;
  question: string;
  expect?: 'question' | 'change';
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  let projectId: string | undefined;
  let repo: string | undefined;
  let question = 'Does this app have an admin feature?';
  let expect: 'question' | 'change' | undefined;
  for (const a of argv) {
    // Note: use --id (not --project) — ts-node/tsconfig-paths reserves --project.
    if (a.startsWith('--id=')) projectId = a.slice('--id='.length);
    else if (a.startsWith('--repo=')) repo = a.slice('--repo='.length);
    else if (a.startsWith('--q=')) question = a.slice('--q='.length);
    else if (a === '--expect=question') expect = 'question';
    else if (a === '--expect=change') expect = 'change';
  }
  return { projectId, repo, question, expect };
}

async function main() {
  const args = parseArgs();

  if (!process.env.CURSOR_API_KEY) {
    throw new Error('CURSOR_API_KEY is required');
  }

  console.log('• Booting Nest DI container…');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  try {
    const projectModel = app.get<Model<UserProject>>(
      getModelToken(UserProject.name),
    );

    let owner: string;
    let repo: string;

    if (args.repo) {
      const [o, r] = args.repo.split('/');
      if (!o || !r) throw new Error('--repo must look like owner/name');
      owner = o;
      repo = r;
    } else if (args.projectId) {
      const project = await projectModel
        .findById(args.projectId)
        .select('jarvisGithub')
        .lean();
      if (!project?.jarvisGithub) {
        throw new Error(`Project ${args.projectId} has no Jarvis GitHub repo`);
      }
      owner = project.jarvisGithub.owner;
      repo = project.jarvisGithub.repo;
    } else {
      throw new Error('Pass --repo=owner/name or --id=<projectId>');
    }

    const cursor = app.get(CursorService);

    console.log(`• Repo:   ${owner}/${repo}`);
    console.log(`• Prompt: ${args.question}`);
    console.log('• Waiting for the agent to finish…');

    const start = Date.now();
    const result = await cursor.runStandaloneUserPromptRound({
      projectId: args.projectId ?? 'smoke',
      owner,
      repo,
      userPrompt: args.question,
    });
    const wallMs = Date.now() - start;

    console.log('');
    console.log(`status:    ${result.status}`);
    console.log(`run:       ${result.agentId ?? '-'} / ${result.runId ?? '-'}`);
    console.log(
      `pr:        ${result.prNumber ?? '(none)'} ${result.prUrl ?? ''}`,
    );
    console.log(`mergedSha: ${result.mergedSha ?? '(none)'}`);
    console.log(`elapsed:   ${(wallMs / 1000).toFixed(1)}s`);
    console.log('');
    console.log('── agentMessage ────────────────────────────────────────');
    console.log(result.agentMessage ?? '(none captured)');
    console.log('────────────────────────────────────────────────────────');

    const changedCode = result.prNumber != null;

    if (args.expect === 'question') {
      if (changedCode) {
        console.error(
          `FAIL: expected a read-only answer but the agent opened PR #${result.prNumber}`,
        );
        process.exitCode = 1;
      } else if (!result.agentMessage?.trim()) {
        console.error(
          'FAIL: no changes AND no answer — chat would show an error',
        );
        process.exitCode = 1;
      } else {
        console.log('PASS: answered without touching the repo');
      }
    }

    if (args.expect === 'change') {
      if (result.status !== 'merged') {
        console.error(`FAIL: expected a merged change, got ${result.status}`);
        process.exitCode = 1;
      } else {
        console.log('PASS: change was implemented and merged');
      }
    }
  } finally {
    await app.close();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
