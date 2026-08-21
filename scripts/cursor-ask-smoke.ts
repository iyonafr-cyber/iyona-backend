/**
 * Smoke test for the read-only codebase Q&A path
 * (`CursorService.askCodebaseQuestion`, exposed as POST
 * /projects/:projectId/workspace/ask).
 *
 * Boots the full Nest DI container — so it also validates that the new
 * WorkspaceController wiring resolves — then asks a real Cursor Cloud Agent a
 * question about a real repo and prints the agent's final answer.
 *
 * Read-only: no branch, PR, revision, or deploy is created.
 *
 * Usage:
 *   npx ts-node -r tsconfig-paths/register scripts/cursor-ask-smoke.ts --repo=owner/name
 *   npx ts-node -r tsconfig-paths/register scripts/cursor-ask-smoke.ts --repo=owner/name --q="Is there a cart?"
 *   npx ts-node -r tsconfig-paths/register scripts/cursor-ask-smoke.ts --id=<projectId>
 *
 * With --id the repo is resolved from the project's `jarvisGithub`, exactly as
 * the HTTP endpoint does. --list prints projects that have a Jarvis repo.
 */
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { getModelToken } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { AppModule } from '../src/app.module';
import { CursorService } from '../src/cursor/cursor.service';
import { UserProject } from '../src/projects/entities/user-project.entity';

const DEFAULT_QUESTION = 'Does this app have an admin feature?';

interface Args {
  list: boolean;
  projectId?: string;
  repo?: string;
  question: string;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  let list = false;
  let projectId: string | undefined;
  let repo: string | undefined;
  let question = DEFAULT_QUESTION;
  for (const a of argv) {
    // Note: use --id (not --project) — ts-node/tsconfig-paths reserves --project.
    if (a === '--list') list = true;
    else if (a.startsWith('--id=')) projectId = a.slice('--id='.length);
    else if (a.startsWith('--repo=')) repo = a.slice('--repo='.length);
    else if (a.startsWith('--q=')) question = a.slice('--q='.length);
  }
  return { list, projectId, repo, question };
}

async function main() {
  const args = parseArgs();

  if (!process.env.CURSOR_API_KEY) {
    throw new Error('CURSOR_API_KEY is required');
  }

  console.log('• Booting Nest DI container…');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  try {
    const projectModel = app.get<Model<UserProject>>(
      getModelToken(UserProject.name),
    );

    if (args.list) {
      const rows = await projectModel
        .find({ jarvisGithub: { $exists: true }, deletedAt: null })
        .select('_id name jarvisGithub')
        .sort({ updatedAt: -1 })
        .limit(20)
        .lean();
      for (const r of rows) {
        const gh = r.jarvisGithub;
        console.log(
          `  ${String(r._id)}  ${gh?.owner}/${gh?.repo}  ${r.name ?? ''}`,
        );
      }
      return;
    }

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
      throw new Error('Pass --repo=owner/name or --id=<projectId> (or --list)');
    }

    const cursor = app.get(CursorService);

    console.log(`• Repo:     ${owner}/${repo}`);
    console.log(`• Question: ${args.question}`);
    console.log('• Waiting for the agent to finish…');

    const start = Date.now();
    const result = await cursor.askCodebaseQuestion({
      projectId: args.projectId ?? 'smoke',
      owner,
      repo,
      question: args.question,
    });
    const wallMs = Date.now() - start;

    console.log('');
    console.log(`status:   ${result.status}`);
    console.log(`run:      ${result.agentId ?? '-'} / ${result.runId ?? '-'}`);
    console.log(`runState: ${result.runStatus ?? '-'}`);
    console.log(
      `elapsed:  ${(wallMs / 1000).toFixed(1)}s (agent reported ${
        result.durationMs != null
          ? `${(result.durationMs / 1000).toFixed(1)}s`
          : 'n/a'
      })`,
    );
    console.log('');
    console.log('── answer ──────────────────────────────────────────────');
    console.log(result.answer);
    console.log('────────────────────────────────────────────────────────');

    if (result.status !== 'answered') process.exitCode = 1;
  } finally {
    await app.close();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
