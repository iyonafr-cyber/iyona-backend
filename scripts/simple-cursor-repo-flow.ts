/**
 * One-shot local flow (no Redis / Mongo):
 * 1) Create a new GitHub repo (README via auto_init so `main` exists for Cursor)
 * 2) Clone, replace tree with `built-codes/developer-portfolio-source`, push `main`
 * 3) Start Cursor Cloud Agents v1 with auto PR
 * 4) Stream SSE, resolve PR, squash-merge (policy constants below — not env)
 *
 * GitHub auth matches production `RepoService`:
 *   - Prefer `JARVIS_GITHUB_TOKEN` + `JARVIS_GITHUB_ORG` → `POST /orgs/{org}/repos` (private, auto_init), same as `createProjectRepo`.
 *   - Fallback: `GITHUB_PAT` only → repo under the authenticated user (`POST /user/repos`).
 *
 * Prereqs: `git`, Node 20+. For org repos, Cursor needs the GitHub App on that org (Dashboard → Integrations).
 *
 * POST /v1/agents uses branch main as startingRef by default (commit SHA optional via env).
 */
import { execFileSync } from 'child_process';
import { randomBytes } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Octokit } from '@octokit/rest';

/** Same defaults as `CursorService`: `SKIP_MERGE=false`, squash-merge after agent. */
const GITHUB_MERGE_METHOD: 'squash' | 'merge' | 'rebase' = 'squash';

const REPO_ROOT = path.resolve(__dirname, '..');
const SOURCE = path.join(
  REPO_ROOT,
  'built-codes',
  'developer-portfolio-source',
);

function loadOptionalEnvFile(file: string) {
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file, 'utf8');
  for (const raw of text.split(/\r?\n/)) {
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
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

loadOptionalEnvFile(path.join(REPO_ROOT, '.env'));
loadOptionalEnvFile(path.join(__dirname, 'simple-cursor-repo-flow.env'));

function git(cwd: string, args: string[]) {
  execFileSync('git', args, { cwd, stdio: 'inherit' });
}

function basicAuthHeader(apiKey: string) {
  return `Basic ${Buffer.from(`${apiKey}:`, 'utf8').toString('base64')}`;
}

/** Cursor IDs are strings or numbers; avoid String(object). */
function pickScalarId(v: unknown): string {
  if (typeof v === 'string' || typeof v === 'number') return String(v).trim();
  return '';
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Same rules as `RepoService.slugify`. */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

/**
 * Match `RepoService.createProjectRepo`: private repo in org, auto_init, retry on 422 name clash.
 */
async function createOrgProjectRepo(
  octokit: Octokit,
  org: string,
  projectLabel: string,
  explicitNameBase: string | undefined,
): Promise<{ owner: string; repo: string }> {
  const base = slugify(explicitNameBase || projectLabel || 'project');

  for (let attempt = 0; attempt < 5; attempt++) {
    const repoName = `${base}-${randomBytes(3).toString('hex')}`;
    try {
      await octokit.repos.createInOrg({
        org,
        name: repoName,
        private: true,
        auto_init: true,
        description: `Jarvis-generated project: ${projectLabel}`,
      });
      return { owner: org, repo: repoName };
    } catch (err: unknown) {
      const status = (err as { status?: number })?.status;
      if (status === 422 && attempt < 4) continue;
      throw err;
    }
  }
  throw new Error(`Failed to create repo in org "${org}" after 5 attempts`);
}

/** Ensure PAT-visible branch exists (GitHub can lag right after push). */
async function waitForGithubBranch(
  octokit: Octokit,
  owner: string,
  repo: string,
  branch: string,
  maxWaitMs: number,
  intervalMs: number,
): Promise<void> {
  const deadline = Date.now() + maxWaitMs;
  let last = '';
  while (Date.now() < deadline) {
    try {
      await octokit.repos.getBranch({ owner, repo, branch });
      return;
    } catch (e) {
      last = e instanceof Error ? e.message : String(e);
      await sleep(intervalMs);
    }
  }
  throw new Error(
    `Timed out waiting for origin/${branch} via GitHub API: ${last}`,
  );
}

/**
 * `startingRef` for POST /v1/agents: branch name, tag, or commit per Cursor docs.
 * Default branch name `main` — Cursor currently validates SHAs poorly (errors cite "branch '<sha>'").
 * Opt-in commit SHA: CURSOR_STARTING_REF_USE_COMMIT_SHA=1 or set CURSOR_STARTING_REF explicitly.
 */
async function resolveCursorStartingRef(
  octokit: Octokit,
  owner: string,
  repo: string,
  branch: string,
): Promise<{ ref: string; label: string }> {
  const envRef = process.env.CURSOR_STARTING_REF?.trim();
  if (envRef) {
    return {
      ref: envRef,
      label:
        envRef.length > 14
          ? `CURSOR_STARTING_REF=${envRef.slice(0, 14)}…`
          : `CURSOR_STARTING_REF`,
    };
  }

  const useCommitSha =
    process.env.CURSOR_STARTING_REF_USE_COMMIT_SHA === '1' ||
    process.env.CURSOR_STARTING_REF_USE_COMMIT_SHA === 'true';

  if (!useCommitSha) {
    return { ref: branch, label: branch };
  }

  const { data } = await octokit.repos.getBranch({ owner, repo, branch });
  const sha = data.commit?.sha;
  if (!sha) {
    throw new Error(
      `GitHub API returned no commit SHA for branch ${branch} — cannot build Cursor startingRef`,
    );
  }
  return { ref: sha, label: `${branch}@${sha.slice(0, 7)}` };
}

function isCursorCreateRetryableError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes('verify existence of branch') ||
    m.includes('failed to determine repository default branch') ||
    (m.includes('post /v1/agents 400') &&
      (m.includes('branch') || m.includes('default branch')))
  );
}

async function createAgent(baseUrl: string, apiKey: string, body: object) {
  const url = `${baseUrl.replace(/\/$/, '')}/v1/agents`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: basicAuthHeader(apiKey),
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok)
    throw new Error(`POST /v1/agents ${res.status}: ${text.slice(0, 2000)}`);
  const data = JSON.parse(text) as Record<string, unknown>;
  const agent = data.agent as Record<string, unknown> | undefined;
  const run = data.run as Record<string, unknown> | undefined;
  const agentId =
    [
      pickScalarId(agent?.id),
      pickScalarId(agent?.ID),
      pickScalarId(data.agentId),
    ].find((s) => s.length > 0) ?? null;
  const runId =
    [
      pickScalarId(run?.id),
      pickScalarId(run?.ID),
      pickScalarId(data.runId),
    ].find((s) => s.length > 0) ?? null;
  if (!agentId || !runId) throw new Error('create agent response missing ids');
  return { agentId, runId };
}

const CURSOR_GITHUB_ACCESS_HELP = `
Cursor could not read this GitHub repo (branch / default-branch checks failed).
Fix (one-time):
  1) Open https://cursor.com/dashboard → Integrations → GitHub
  2) Use the same identity as your token: personal PAT → linked user; JARVIS_GITHUB_TOKEN → org access.
  3) If repos live under JARVIS_GITHUB_ORG, install the "Cursor" GitHub App on that org and grant repo access.

Workaround for testing: unset JARVIS_GITHUB_ORG + JARVIS_GITHUB_TOKEN and set GITHUB_PAT only — the script creates a personal repo (often links to Cursor faster).

Until Cursor can list/read the repo, POST /v1/agents will keep failing — not a bug in this script.
`.trim();

function cursorCreateRetryDelayMs(attempt: number, access: boolean): number {
  if (access) {
    return Math.min(60_000, 4000 * 2 ** attempt);
  }
  return 2000 + attempt * 2000;
}

function cursorCreateMaxAttempts(): number {
  const raw = process.env.CURSOR_CREATE_MAX_ATTEMPTS?.trim();
  const n = raw ? parseInt(raw, 10) : 8;
  if (!Number.isFinite(n)) return 8;
  return Math.min(12, Math.max(3, n));
}

function isCursorGitHubAccessError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes('verify existence of branch') ||
    m.includes('failed to determine repository default branch')
  );
}

function formatCursorCreateRetryLine(
  access: boolean,
  attempt: number,
  maxAttempts: number,
  waitMs: number,
): string {
  if (access) {
    return (
      `POST /v1/agents failed: Cursor cannot verify this repo/ref from GitHub on Cursor's side ` +
      `(Dashboard → Integrations + GitHub App on the org when using JARVIS_GITHUB_ORG — not your script being "not ready"). ` +
      `Retry ${attempt + 1}/${maxAttempts} in ${waitMs}ms (waits only help propagation).`
    );
  }
  return `POST /v1/agents failed (retryable). Retry ${attempt + 1}/${maxAttempts} in ${waitMs}ms…`;
}

async function createAgentWithRetry(
  baseUrl: string,
  cursorKey: string,
  body: object,
  repoLabel: string,
): Promise<{ agentId: string; runId: string }> {
  const maxAttempts = cursorCreateMaxAttempts();
  let lastErr: Error | undefined;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await createAgent(baseUrl, cursorKey, body);
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e));
      const access = isCursorGitHubAccessError(lastErr.message);
      if (access) {
        if (attempt === maxAttempts - 1) {
          throw new Error(
            `${lastErr.message}\n\nRepository: ${repoLabel}\n\n${CURSOR_GITHUB_ACCESS_HELP}`,
          );
        }
      } else if (
        !isCursorCreateRetryableError(lastErr.message) ||
        attempt === maxAttempts - 1
      ) {
        throw lastErr;
      }
      const waitMs = cursorCreateRetryDelayMs(attempt, access);
      console.log(
        formatCursorCreateRetryLine(access, attempt, maxAttempts, waitMs),
      );
      await sleep(waitMs);
    }
  }
  throw lastErr ?? new Error('createAgentWithRetry exhausted');
}

async function getRun(
  baseUrl: string,
  apiKey: string,
  agentId: string,
  runId: string,
): Promise<Record<string, unknown>> {
  const url = `${baseUrl.replace(/\/$/, '')}/v1/agents/${encodeURIComponent(agentId)}/runs/${encodeURIComponent(runId)}`;
  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
      Authorization: basicAuthHeader(apiKey),
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`GET run ${res.status}: ${text.slice(0, 800)}`);
  return JSON.parse(text) as Record<string, unknown>;
}

function parseSse(block: string): { event?: string; data: string } | null {
  const lines = block.split(/\r?\n/).filter((l) => l.length > 0);
  let event: string | undefined;
  const dataLines: string[] = [];
  for (const line of lines) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:'))
      dataLines.push(line.slice(5).trimStart());
  }
  if (dataLines.length === 0) return null;
  return { event, data: dataLines.join('\n') };
}

async function streamRun(
  baseUrl: string,
  apiKey: string,
  agentId: string,
  runId: string,
  onLine: (info: { event?: string; json?: unknown; raw: string }) => void,
) {
  const url = `${baseUrl.replace(/\/$/, '')}/v1/agents/${encodeURIComponent(agentId)}/runs/${encodeURIComponent(runId)}/stream`;
  const res = await fetch(url, {
    headers: {
      Accept: 'text/event-stream',
      Authorization: basicAuthHeader(apiKey),
    },
  });
  if (!res.ok || !res.body) {
    const t = await res.text().catch(() => '');
    throw new Error(`SSE ${res.status}: ${t.slice(0, 600)}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let carry = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      carry += decoder.decode(value, { stream: true });
      const blocks = carry.split(/\r?\n\r?\n/);
      carry = blocks.pop() ?? '';
      for (const block of blocks) {
        const parsed = parseSse(block);
        if (!parsed) continue;
        let json: unknown;
        try {
          json = JSON.parse(parsed.data);
        } catch {
          json = undefined;
        }
        onLine({ event: parsed.event, json, raw: parsed.data });
      }
    }
    if (carry.trim()) {
      const parsed = parseSse(carry);
      if (parsed) {
        let json: unknown;
        try {
          json = JSON.parse(parsed.data);
        } catch {
          json = undefined;
        }
        onLine({ event: parsed.event, json, raw: parsed.data });
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Best-effort token usage from Cursor stream / run JSON (shapes vary; API may omit).
 */
function formatTokenUsageFromJson(obj: unknown, depth = 0): string | null {
  if (depth > 10 || obj === null || obj === undefined) return null;
  if (typeof obj === 'object') {
    const o = obj as Record<string, unknown>;
    if ('usage' in o && typeof o.usage === 'object' && o.usage !== null) {
      const u = o.usage as Record<string, unknown>;
      const n = (keys: string[]) => {
        for (const k of keys) {
          const v = u[k];
          if (typeof v === 'number' && Number.isFinite(v)) return v;
        }
        return undefined;
      };
      const inT = n([
        'input_tokens',
        'prompt_tokens',
        'inputTokens',
        'cache_read_input_tokens',
      ]);
      const outT = n(['output_tokens', 'completion_tokens', 'outputTokens']);
      const tot = n(['total_tokens', 'totalTokens']);
      const parts: string[] = [];
      if (inT != null) parts.push(`in ${inT}`);
      if (outT != null) parts.push(`out ${outT}`);
      if (tot != null) parts.push(`total ${tot}`);
      if (parts.length) return parts.join(', ');
    }
    for (const v of Object.values(o)) {
      const inner = formatTokenUsageFromJson(v, depth + 1);
      if (inner) return inner;
    }
  }
  return null;
}

/** One-line description of an announced tool / action (stream payload shape varies). */
function summarizeTaskLine(eventName: string, json: unknown): string {
  if (typeof json !== 'object' || json === null) {
    return eventName;
  }
  const o = json as Record<string, unknown>;
  const name =
    (typeof o.name === 'string' && o.name) ||
    (typeof o.toolName === 'string' && o.toolName) ||
    (typeof o.tool === 'string' && o.tool) ||
    '';
  const status = typeof o.status === 'string' ? o.status : '';
  const message = typeof o.message === 'string' ? o.message : '';
  const id = typeof o.id === 'string' ? o.id : '';
  const head = [name, status, id].filter(Boolean).join(' — ');
  if (head) return head;
  if (message)
    return message.length > 200 ? `${message.slice(0, 200)}…` : message;
  const raw = JSON.stringify(json);
  return raw.length > 220 ? `${raw.slice(0, 220)}…` : raw;
}

function walkForPr(obj: unknown, depth = 0): { number?: number; url?: string } {
  if (depth > 12 || obj === null || obj === undefined) return {};
  if (typeof obj === 'string') {
    const m = obj.match(/https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/(\d+)/);
    if (m) return { number: parseInt(m[1], 10), url: obj };
    return {};
  }
  if (typeof obj !== 'object') return {};
  const o = obj as Record<string, unknown>;
  for (const k of Object.keys(o)) {
    const lk = k.toLowerCase();
    if (
      (lk.includes('pull') && lk.includes('number')) ||
      lk === 'pull_number' ||
      lk === 'prnumber' ||
      lk === 'pr_number'
    ) {
      const v = o[k];
      if (typeof v === 'number') return { number: v };
      if (typeof v === 'string' && /^\d+$/.test(v))
        return { number: parseInt(v, 10) };
    }
    if (
      lk === 'html_url' &&
      typeof o[k] === 'string' &&
      o[k].includes('/pull/')
    ) {
      const url = o[k];
      const m2 = url.match(/\/pull\/(\d+)/);
      if (m2) return { number: parseInt(m2[1], 10), url };
    }
  }
  for (const k of Object.keys(o)) {
    const inner = walkForPr(o[k], depth + 1);
    if (inner.number != null || inner.url) return inner;
  }
  return {};
}

function extractHeadFromRun(run: Record<string, unknown>): string | null {
  const s = JSON.stringify(run);
  const patterns = [
    /"head"\s*:\s*"([^"]+)"/i,
    /"headRef"\s*:\s*"([^"]+)"/i,
    /"head_branch"\s*:\s*"([^"]+)"/i,
    /"branchName"\s*:\s*"([^"]+)"/i,
  ];
  for (const p of patterns) {
    const m = s.match(p);
    if (m?.[1] && !m[1].includes('://')) return m[1];
  }
  return null;
}

async function githubMarkPullReadyGraphql(
  pat: string,
  pullRequestNodeId: string,
): Promise<void> {
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${pat}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query: `mutation ($id: ID!) {
        markPullRequestReadyForReview(input: { pullRequestId: $id }) {
          pullRequest { isDraft }
        }
      }`,
      variables: { id: pullRequestNodeId },
    }),
  });
  const body = (await res.json()) as {
    errors?: { message: string }[];
    data?: {
      markPullRequestReadyForReview?: { pullRequest?: { isDraft?: boolean } };
    };
  };
  if (!res.ok || body.errors?.length) {
    throw new Error(
      `GraphQL markPullRequestReadyForReview: HTTP ${res.status} ${JSON.stringify(body.errors ?? body)}`,
    );
  }
}

async function main() {
  const token =
    process.env.JARVIS_GITHUB_TOKEN?.trim() ||
    process.env.GITHUB_PAT?.trim() ||
    '';
  const jarvisOrg = process.env.JARVIS_GITHUB_ORG?.trim() || '';
  const useOrgFlow = Boolean(jarvisOrg);

  if (process.env.JARVIS_GITHUB_TOKEN?.trim() && !jarvisOrg) {
    throw new Error(
      'JARVIS_GITHUB_ORG must be set when JARVIS_GITHUB_TOKEN is set (same as RepoService / production).',
    );
  }

  const cursorKey = process.env.CURSOR_API_KEY ?? '';
  const baseUrl = process.env.CURSOR_API_BASE_URL ?? 'https://api.cursor.com';
  const modelId = process.env.CURSOR_AGENT_MODEL_ID?.trim() || 'composer-2';
  const task =
    process.env.AGENT_TASK?.trim() ||
    [
      'Fix any syntax errors, missing or wrong imports, broken module paths, and type issues; close logic gaps and cover reasonable edge cases.',
      'Fix broken links (routes, hrefs, asset/public paths) and anything that prevents the app from loading or navigating correctly.',
      'Fix CSS and layout (including responsive/mobile), contrast, and obvious accessibility issues.',
      'Align package.json, lockfile, tsconfig, and Vite config so install, `npm run dev`, and `npm run build` work; add any missing dependencies or scripts needed for a smooth local run.',
      'Prefer minimal, safe edits. Do not add live API calls or secrets.',
      'When you open a pull request, open it as ready for review (not draft).',
      'Create PRs targeting `main`; when checks pass, squash-merge into `main` or enable GitHub auto-merge to `main` when supported.',
    ].join('\n');

  if (!token)
    throw new Error(
      'GitHub token required: set JARVIS_GITHUB_TOKEN (+ JARVIS_GITHUB_ORG) or GITHUB_PAT for a personal-repo fallback',
    );
  if (!cursorKey) throw new Error('CURSOR_API_KEY is required');
  if (!fs.existsSync(SOURCE))
    throw new Error(`Missing source folder: ${SOURCE}`);

  const octokit = new Octokit({ auth: token });

  const nameBase =
    process.env.GITHUB_REPO_NAME?.trim() || 'developer-portfolio';
  const projectLabel = nameBase;

  let owner: string;
  let repoName: string;

  if (useOrgFlow) {
    console.log(
      `Creating repo in org ${jarvisOrg} (private, auto_init — server parity)…`,
    );
    const created = await createOrgProjectRepo(
      octokit,
      jarvisOrg,
      projectLabel,
      nameBase,
    );
    owner = created.owner;
    repoName = created.repo;
    console.log(`Created ${owner}/${repoName}`);
  } else {
    const { data: me } = await octokit.users.getAuthenticated();
    owner = me.login;
    repoName =
      process.env.GITHUB_REPO_NAME?.trim() ||
      `developer-portfolio-${Date.now().toString(36)}`;

    /** Personal fallback: public by default for easier Cursor branch checks; set CURSOR_FLOW_PRIVATE_REPO=1 for private. */
    const repoPrivate =
      process.env.CURSOR_FLOW_PRIVATE_REPO === '1' ||
      process.env.CURSOR_FLOW_PRIVATE_REPO === 'true';

    console.log(`Creating repo ${owner}/${repoName} (personal account)…`);
    await octokit.repos.createForAuthenticatedUser({
      name: repoName,
      private: repoPrivate,
      auto_init: true,
      description: 'Seeded from Jarvis simple-cursor-repo-flow',
    });
  }

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-portfolio-'));
  try {
    const remote = `https://x-access-token:${token}@github.com/${owner}/${repoName}.git`;
    console.log(`Cloning fresh repo (README init) → ${workDir}`);
    git(workDir, ['clone', '--depth', '1', remote, '.']);

    for (const name of fs.readdirSync(workDir)) {
      if (name === '.git') continue;
      fs.rmSync(path.join(workDir, name), { recursive: true, force: true });
    }

    console.log(`Copying template → ${workDir}`);
    fs.cpSync(SOURCE, workDir, {
      recursive: true,
      filter: (src) => {
        const rel = path.relative(SOURCE, src);
        const segments = rel.split(path.sep).filter(Boolean);
        if (segments.includes('node_modules')) return false;
        if (segments[0] === '.git') return false;
        if (segments[0] === 'dist') return false;
        if (segments.includes('.DS_Store')) return false;
        if (path.basename(src) === '.DS_Store') return false;
        return true;
      },
    });

    console.log('Commit + push template to main...');
    git(workDir, ['add', '-A']);
    git(workDir, [
      '-c',
      'user.name=Jarvis Flow',
      '-c',
      'user.email=jarvis-flow@localhost',
      'commit',
      '-m',
      'chore: seed developer portfolio template',
    ]);
    git(workDir, ['push', 'origin', 'main']);

    console.log('Waiting until GitHub API reports branch main…');
    await waitForGithubBranch(octokit, owner, repoName, 'main', 120_000, 2_000);

    const settleMs = Math.max(
      0,
      parseInt(process.env.CURSOR_POST_PUSH_SETTLE_MS ?? '15000', 10) || 15_000,
    );
    const { ref: startingRef, label: startingLabel } =
      await resolveCursorStartingRef(octokit, owner, repoName, 'main');
    console.log(
      `Cursor startingRef → ${startingLabel} (${startingRef === 'main' ? 'branch name — recommended for Cloud Agents API' : 'custom ref'})`,
    );
    if (settleMs > 0) {
      console.log(`Post-push settle ${settleMs}ms before POST /v1/agents…`);
      await sleep(settleMs);
    }

    const repoHttps = `https://github.com/${owner}/${repoName}`;
    console.log(
      `Starting Cursor Cloud Agent on ${repoHttps} (model: ${modelId})…`,
    );

    const body = {
      prompt: {
        text: [
          'You are fixing code in the connected GitHub repository.',
          'Follow the task carefully. Prefer minimal, safe changes.',
          'Keep strictly to the point: no unrelated edits or extra scope unless explicitly asked.',
          'Do not print secrets or tokens.',
          'Keep any natural-language replies short: no long paragraphs or essays—state what you changed and move on.',
          'When you open a pull request, open it as ready for review (not draft).',
          'Create PRs targeting `main`; when checks pass, squash-merge into `main` or enable GitHub auto-merge to `main` when supported.',
          '',
          task,
        ].join('\n'),
      },
      model: { id: modelId },
      repos: [{ url: repoHttps, startingRef }],
      autoCreatePR: true,
    };

    const { agentId, runId } = await createAgentWithRetry(
      baseUrl,
      cursorKey,
      body,
      `${owner}/${repoName}`,
    );
    console.log(
      `Agent ${agentId} run ${runId} — streaming (task + tokens only)…`,
    );

    let lastPayload: unknown;
    let streamError = false;
    let lastUsageLogged = '';
    await streamRun(baseUrl, cursorKey, agentId, runId, (evt) => {
      if (evt.json !== undefined) lastPayload = evt.json;
      let typeFromJson = '';
      if (
        typeof evt.json === 'object' &&
        evt.json !== null &&
        'type' in evt.json
      ) {
        typeFromJson = pickScalarId((evt.json as Record<string, unknown>).type);
      }
      const kind = evt.event ?? typeFromJson;

      const errObj =
        typeof evt.json === 'object' &&
        evt.json !== null &&
        'error' in evt.json;
      if (kind === 'error' || errObj) streamError = true;

      const usageLine = formatTokenUsageFromJson(evt.json);
      if (usageLine && usageLine !== lastUsageLogged) {
        console.log(`[tokens] ${usageLine}`);
        lastUsageLogged = usageLine;
      }

      switch (kind) {
        case 'heartbeat':
        case 'done':
          break;
        case 'assistant':
        case 'thinking':
          break;
        case 'status': {
          const st =
            typeof evt.json === 'object' &&
            evt.json !== null &&
            'status' in evt.json
              ? pickScalarId((evt.json as Record<string, unknown>).status)
              : '';
          if (st) console.log(`[task] status ${st}`);
          break;
        }
        case 'tool_call':
          console.log(`[task] ${summarizeTaskLine(kind, evt.json)}`);
          break;
        case 'result': {
          const st =
            typeof evt.json === 'object' &&
            evt.json !== null &&
            'status' in evt.json
              ? pickScalarId((evt.json as Record<string, unknown>).status)
              : '';
          if (st) console.log(`[task] result ${st}`);
          break;
        }
        case 'error': {
          let msg = evt.raw;
          if (typeof evt.json === 'object' && evt.json !== null) {
            const m = (evt.json as Record<string, unknown>).message;
            if (typeof m === 'string') msg = m;
            else if (typeof m === 'number' || typeof m === 'boolean')
              msg = String(m);
            else if (m !== undefined && m !== null) msg = JSON.stringify(m);
          }
          console.error(`[task] error ${msg.slice(0, 400)}`);
          break;
        }
        default:
          break;
      }
    });

    if (streamError) throw new Error('Cursor agent stream reported an error');

    const runJson = await getRun(baseUrl, cursorKey, agentId, runId);
    const runUsage = formatTokenUsageFromJson(runJson);
    if (runUsage && runUsage !== lastUsageLogged) {
      console.log(`[tokens] ${runUsage}`);
    }
    let pr = walkForPr(lastPayload);
    if (pr.number == null) pr = walkForPr(runJson);
    if (pr.number == null) {
      const head = extractHeadFromRun(runJson);
      if (head) {
        const headRef = `${owner}:${head}`;
        const { data: pulls } = await octokit.pulls.list({
          owner,
          repo: repoName,
          state: 'open',
          head: headRef,
          per_page: 5,
        });
        const open = pulls[0];
        if (open) pr = { number: open.number, url: open.html_url };
      }
    }

    if (pr.number == null) {
      throw new Error(
        'Could not resolve PR from agent run (check Cursor + GitHub token permissions).',
      );
    }

    console.log(`PR #${pr.number} ${pr.url ?? ''}`);

    const { data: prMeta } = await octokit.pulls.get({
      owner,
      repo: repoName,
      pull_number: pr.number,
    });
    if (prMeta.draft) {
      console.log(
        'PR is draft — marking ready for review so GitHub allows merge…',
      );
      const updated = await octokit.pulls.update({
        owner,
        repo: repoName,
        pull_number: pr.number,
        draft: false,
        state: 'open',
      });
      console.log(`pulls.update ok; draft flag now: ${updated.data.draft}`);
    }
    for (let poll = 0; poll < 20; poll++) {
      const { data: check } = await octokit.pulls.get({
        owner,
        repo: repoName,
        pull_number: pr.number,
      });
      if (!check.draft) break;
      if (poll === 8) {
        try {
          console.log('Trying GraphQL markPullRequestReadyForReview…');
          await githubMarkPullReadyGraphql(token, prMeta.node_id);
        } catch (ge) {
          console.warn(ge instanceof Error ? ge.message : String(ge));
        }
      }
      if (poll === 19) {
        throw new Error(
          'PR is still draft after ready-for-review; PAT may lack permission or org policy blocks clearing draft.',
        );
      }
      await sleep(1500);
    }

    const mm =
      GITHUB_MERGE_METHOD === 'merge' ||
      GITHUB_MERGE_METHOD === 'squash' ||
      GITHUB_MERGE_METHOD === 'rebase'
        ? GITHUB_MERGE_METHOD
        : 'squash';
    let mergeData: { merged?: boolean; sha?: string } = {};
    for (let attempt = 0; attempt < 8; attempt++) {
      try {
        const { data } = await octokit.pulls.merge({
          owner,
          repo: repoName,
          pull_number: pr.number,
          merge_method: mm,
        });
        mergeData = data;
        break;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const draftish = msg.toLowerCase().includes('draft');
        if (!draftish || attempt === 7) throw e;
        console.log('Merge said draft — re-send ready + wait…');
        await octokit.pulls.update({
          owner,
          repo: repoName,
          pull_number: pr.number,
          draft: false,
          state: 'open',
        });
        await sleep(2000 + attempt * 1500);
      }
    }

    console.log('\n✅ DONE');
    console.log(`  Repo:  ${repoHttps}`);
    console.log(`  PR:    ${pr.url ?? `#${pr.number}`}`);
    console.log(
      `  Merge: ${mergeData.merged ? `merged, sha ${mergeData.sha}` : 'not merged (already merged or blocked)'}`,
    );
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
