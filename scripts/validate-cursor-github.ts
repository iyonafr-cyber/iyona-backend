/* eslint-disable no-console */
/**
 * Validate Cursor API key + GitHub repo visibility for spec-build handoff.
 *
 * Jarvis PAT can own a repo while Cursor still cannot read `main` — usually
 * the Cursor GitHub App is missing on JARVIS_GITHUB_ORG.
 *
 * Usage:
 *   npm run cursor:validate-github -- --owner=jarvis-sites --repo=my-repo
 *   npm run cursor:validate-github -- --env=/path/to/.env --owner=jarvis-sites --repo=my-repo
 *
 * Exit 0 = Cursor can verify the repo ref. Exit 1 = misconfigured or no access.
 */
import * as fs from 'fs';
import * as path from 'path';
import { Octokit } from '@octokit/rest';

type EnvMap = Record<string, string>;

function parseEnvFile(file: string): EnvMap {
  const out: EnvMap = {};
  if (!fs.existsSync(file)) return out;
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

function parseArgs(): {
  envFile: string;
  owner?: string;
  repo?: string;
  branch: string;
} {
  const repoRoot = path.resolve(__dirname, '..');
  let envFile = path.join(repoRoot, '.env');
  let owner: string | undefined;
  let repo: string | undefined;
  let branch = 'main';
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--env=')) envFile = path.resolve(arg.slice('--env='.length));
    else if (arg.startsWith('--owner=')) owner = arg.slice('--owner='.length).trim();
    else if (arg.startsWith('--repo=')) repo = arg.slice('--repo='.length).trim();
    else if (arg.startsWith('--branch=')) branch = arg.slice('--branch='.length).trim();
  }
  return { envFile, owner, repo, branch };
}

function maskSecret(value: string): string {
  if (value.length <= 10) return '***';
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

function resolvePat(env: EnvMap): { token: string; source: string } {
  const pat = env.GITHUB_PAT?.trim();
  if (pat) return { token: pat, source: 'GITHUB_PAT' };
  const jarvis = env.JARVIS_GITHUB_TOKEN?.trim();
  if (jarvis) return { token: jarvis, source: 'JARVIS_GITHUB_TOKEN' };
  return { token: '', source: '' };
}

function basicAuthHeader(apiKey: string): string {
  return `Basic ${Buffer.from(`${apiKey}:`, 'utf8').toString('base64')}`;
}

function isCursorGitHubAccessError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes('verify existence of branch') ||
    m.includes('failed to determine repository default branch') ||
    (m.includes('post /v1/agents') && m.includes('branch'))
  );
}

const CURSOR_GITHUB_HELP = `
Cursor cannot read this GitHub repo (branch check failed) even though your PAT can.

Fix (one-time):
  1) https://cursor.com/dashboard → Integrations → GitHub
  2) Install the Cursor GitHub App on the org that owns repos (JARVIS_GITHUB_ORG)
  3) Grant access to org repositories

Workaround: unset JARVIS_GITHUB_ORG so repos are created under the PAT user account
that Cursor already covers, then start a new project.
`.trim();

function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = 30_000,
): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
}

async function main(): Promise<void> {
  const { envFile, owner: ownerArg, repo: repoArg, branch } = parseArgs();
  const fileEnv = parseEnvFile(envFile);

  console.log(`Env file: ${envFile}`);

  const cursorKey = fileEnv.CURSOR_API_KEY?.trim() ?? '';
  const baseUrl = (fileEnv.CURSOR_API_BASE_URL ?? 'https://api.cursor.com').replace(
    /\/$/,
    '',
  );
  const modelId = fileEnv.CURSOR_AGENT_MODEL_ID?.trim() || 'composer-2';
  const org = fileEnv.JARVIS_GITHUB_ORG?.trim() ?? '';
  const { token: githubToken, source: patSource } = resolvePat(fileEnv);

  if (!cursorKey) {
    console.error('FAIL: CURSOR_API_KEY is not set in .env');
    process.exit(1);
  }
  if (!githubToken) {
    console.error('FAIL: GITHUB_PAT or JARVIS_GITHUB_TOKEN is not set in .env');
    process.exit(1);
  }
  if (!ownerArg || !repoArg) {
    console.error(
      'FAIL: pass --owner=<github-owner> --repo=<repo-name> (e.g. jarvis-sites/space-themed-todo-app-term)',
    );
    process.exit(1);
  }

  const owner = ownerArg;
  const repo = repoArg;
  const repoHttps = `https://github.com/${owner}/${repo}`;
  const repoLabel = `${owner}/${repo}`;

  console.log(`Cursor key: ${maskSecret(cursorKey)}`);
  console.log(`GitHub PAT (${patSource}): ${maskSecret(githubToken)}`);
  console.log(`JARVIS_GITHUB_ORG: ${org || '(none)'}`);
  console.log(`Probe repo: ${repoLabel} @ ${branch}`);

  // 1) Cursor API identity
  const meRes = await fetchWithTimeout(`${baseUrl}/v1/me`, {
    headers: { Authorization: `Bearer ${cursorKey}`, Accept: 'application/json' },
  });
  const meBody = (await meRes.json()) as Record<string, unknown>;
  if (!meRes.ok) {
    console.error('FAIL: Cursor API key rejected —', meBody.message ?? meRes.status);
    process.exit(1);
  }
  const email =
    (typeof meBody.userEmail === 'string' && meBody.userEmail) ||
    (typeof meBody.email === 'string' && meBody.email) ||
    'ok';
  console.log(`OK: Cursor API authenticated (${email})`);

  // 2) Jarvis PAT sees the repo + branch
  const octokit = new Octokit({ auth: githubToken });
  try {
    const { data: user } = await octokit.users.getAuthenticated();
    console.log(`OK: GitHub PAT authenticated as ${user.login}`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`FAIL: GitHub PAT rejected — ${msg}`);
    process.exit(1);
  }

  try {
    const { data } = await octokit.repos.getBranch({ owner, repo, branch });
    console.log(`OK: PAT can read ${repoLabel}@${data.name} (sha ${data.commit.sha.slice(0, 7)})`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`FAIL: PAT cannot read ${repoLabel}@${branch} — ${msg}`);
    process.exit(1);
  }

  // 3) Cursor can verify the same ref (spec-build handoff probe)
  console.log(`\n── Cursor repo probe (POST /v1/agents) ──`);
  const agentBody = {
    prompt: {
      text: 'Connectivity probe only. Do not modify any files. Reply DONE.',
    },
    model: { id: modelId },
    repos: [{ url: repoHttps, startingRef: branch }],
    autoCreatePR: false,
  };

  const res = await fetchWithTimeout(`${baseUrl}/v1/agents`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: basicAuthHeader(cursorKey),
    },
    body: JSON.stringify(agentBody),
  }, 60_000);
  const text = await res.text();

  if (!res.ok) {
    const snippet = text.slice(0, 500);
    console.error(`FAIL: POST /v1/agents ${res.status}: ${snippet}`);
    if (isCursorGitHubAccessError(text)) {
      console.error(`\n${CURSOR_GITHUB_HELP}`);
    }
    process.exit(1);
  }

  let agentId = '';
  let runId = '';
  try {
    const data = JSON.parse(text) as Record<string, unknown>;
    const agent = data.agent as Record<string, unknown> | undefined;
    const run = data.run as Record<string, unknown> | undefined;
    agentId =
      String(agent?.id ?? agent?.ID ?? data.agentId ?? '').trim();
    runId = String(run?.id ?? run?.ID ?? data.runId ?? '').trim();
  } catch {
    // still ok if create succeeded
  }

  console.log(
    `OK: Cursor can access ${repoLabel}@${branch}${agentId ? ` (agent ${agentId})` : ''}`,
  );
  if (agentId && runId) {
    console.log(
      'NOTE: A short-lived probe agent was created. It may run briefly; cancel in Cursor dashboard if needed.',
    );
  }
  console.log('\nAll checks passed — spec-build Cursor handoff should work for this repo.');
}

main().catch((err: unknown) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
