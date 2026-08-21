/**
 * Run the completeness gate on demand against any generated app — the SAME
 * `evaluateCompleteness` + `buildCompletenessScorecard` the deploy pipeline
 * runs (src/common/content-completeness.ts), so what you see here is exactly
 * what a deploy would flag.
 *
 * Without this you can only observe completeness after a deploy (backend log
 * line + `deployments.metadata.completeness` in Mongo). This checks a tree
 * directly, before or instead of deploying.
 *
 * Usage:
 *   # a local checkout of a generated app
 *   npm run completeness -- ./path/to/generated-app
 *
 *   # a Jarvis-built repo straight from GitHub (needs JARVIS_GITHUB_TOKEN)
 *   npm run completeness -- --repo owner/repo
 *   npm run completeness -- --repo owner/repo --sha <commit>
 *
 * Flags:
 *   --idea "<text>"  product idea used to pick the archetype page floor
 *                    (defaults to the repo/folder name)
 *   --json           machine-readable output (for CI / dashboards)
 *   --hint           print the exact repair hint Cursor would receive
 *
 * Exit code is 0 when clean, 1 when issues were found — so CI can gate on it.
 */
import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';
import {
  evaluateCompleteness,
  buildCompletenessScorecard,
  formatCompletenessHintForCursor,
} from '../src/common/content-completeness';

/** Directories that are never part of the authored source tree. */
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  'coverage',
  '.vercel',
  '.turbo',
]);

/** Binary-ish files the text checks can't reason about. */
const SKIP_EXT = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.avif',
  '.ico',
  '.svg',
  '.woff',
  '.woff2',
  '.ttf',
  '.otf',
  '.mp4',
  '.webm',
  '.pdf',
  '.zip',
]);

function parseArgs(): {
  dir?: string;
  repo?: string;
  sha?: string;
  idea?: string;
  json: boolean;
  hint: boolean;
} {
  const argv = process.argv.slice(2);
  const flags = new Set(argv.filter((a) => a.startsWith('--')));
  const valueOf = (name: string): string | undefined => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const positional = argv.filter((a, i) => {
    if (a.startsWith('--')) return false;
    const prev = argv[i - 1];
    return !(prev === '--repo' || prev === '--sha' || prev === '--idea');
  });

  return {
    dir: positional[0],
    repo: valueOf('repo'),
    sha: valueOf('sha'),
    idea: valueOf('idea'),
    json: flags.has('--json'),
    hint: flags.has('--hint'),
  };
}

/** Read a local checkout into the same `Record<path, content>` shape the pipeline uses. */
function readLocalTree(root: string): Record<string, string> {
  const files: Record<string, string> = {};
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.') && entry.name !== '.env.example') {
        if (entry.isDirectory()) continue;
      }
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        walk(abs);
        continue;
      }
      if (SKIP_EXT.has(path.extname(entry.name).toLowerCase())) continue;
      const rel = path.relative(root, abs).split(path.sep).join('/');
      try {
        files[rel] = fs.readFileSync(abs, 'utf8');
      } catch {
        // Unreadable/binary — skip rather than abort the whole run.
      }
    }
  };
  walk(root);
  return files;
}

/** Read a GitHub repo tree at a ref, mirroring RepoService.readTreeAtSha. */
async function readGithubTree(
  ownerRepo: string,
  sha?: string,
): Promise<Record<string, string>> {
  const token = process.env.JARVIS_GITHUB_TOKEN;
  if (!token) {
    throw new Error('JARVIS_GITHUB_TOKEN is required for --repo');
  }
  const [owner, repo] = ownerRepo.split('/');
  if (!owner || !repo) {
    throw new Error(`--repo must be "owner/repo", got "${ownerRepo}"`);
  }

  const http = axios.create({
    baseURL: 'https://api.github.com',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
    },
  });

  let ref = sha;
  if (!ref) {
    const { data } = await http.get(`/repos/${owner}/${repo}/branches/main`);
    ref = data.commit.sha as string;
  }

  const { data: tree } = await http.get(
    `/repos/${owner}/${repo}/git/trees/${ref}`,
    { params: { recursive: '1' } },
  );

  const files: Record<string, string> = {};
  const blobs = (tree.tree as Array<{ path: string; type: string }>).filter(
    (n) =>
      n.type === 'blob' &&
      !SKIP_EXT.has(path.extname(n.path).toLowerCase()) &&
      !n.path.split('/').some((seg) => SKIP_DIRS.has(seg)),
  );

  // Fetch in small batches so a large tree doesn't burst the rate limit.
  const BATCH = 20;
  for (let i = 0; i < blobs.length; i += BATCH) {
    const slice = blobs.slice(i, i + BATCH);
    const results = await Promise.all(
      slice.map(async (n) => {
        const { data } = await http.get(
          `/repos/${owner}/${repo}/contents/${encodeURIComponent(n.path)}`,
          { params: { ref }, headers: { Accept: 'application/vnd.github.raw' } },
        );
        return [n.path, typeof data === 'string' ? data : JSON.stringify(data)] as const;
      }),
    );
    for (const [p, c] of results) files[p] = c;
  }

  return files;
}

async function main() {
  const args = parseArgs();

  if (!args.dir && !args.repo) {
    console.error(
      'Usage:\n' +
        '  npm run completeness -- ./path/to/app\n' +
        '  npm run completeness -- --repo owner/repo [--sha <commit>]\n' +
        '\nFlags: --idea "<text>"  --json  --hint',
    );
    process.exit(2);
  }

  const label = args.repo ?? path.resolve(args.dir!);
  const files = args.repo
    ? await readGithubTree(args.repo, args.sha)
    : readLocalTree(path.resolve(args.dir!));

  if (Object.keys(files).length === 0) {
    console.error(`No readable source files found at ${label}`);
    process.exit(2);
  }

  const idea =
    args.idea ??
    (args.repo ? args.repo.split('/')[1] : path.basename(path.resolve(args.dir!)));

  const report = evaluateCompleteness(files);
  const scorecard = buildCompletenessScorecard(files, idea);

  if (args.json) {
    console.log(
      JSON.stringify({ target: label, scorecard, issues: report.issues }, null, 2),
    );
    process.exit(report.ok ? 0 : 1);
  }

  console.log(`\nCompleteness — ${label}`);
  console.log(`  files scanned : ${Object.keys(files).length}`);
  console.log(`  score         : ${scorecard.score}/100`);
  console.log(`  archetype     : ${scorecard.archetype}`);
  console.log(
    `  routes        : ${scorecard.routesFound}/${scorecard.minPages}` +
      (scorecard.routesFound < scorecard.minPages ? '  ← under the floor' : ''),
  );

  if (report.ok) {
    console.log('\n  No issues. This tree would deploy without a cleanup round.\n');
    process.exit(0);
  }

  console.log(`\n  ${report.issues.length} issue(s) by type:`);
  for (const [reason, count] of Object.entries(scorecard.counts).sort(
    (a, b) => (b[1] as number) - (a[1] as number),
  )) {
    console.log(`    ${String(count).padStart(3)}  ${reason}`);
  }

  // Group by file so the output reads like a review, not a flat dump.
  const byPath = new Map<string, typeof report.issues>();
  for (const issue of report.issues) {
    const list = byPath.get(issue.path) ?? [];
    list.push(issue);
    byPath.set(issue.path, list);
  }

  console.log('');
  for (const [p, list] of byPath) {
    console.log(`  ${p}`);
    for (const i of list) console.log(`    [${i.reason}] ${i.detail}`);
  }

  if (args.hint) {
    console.log('\n─── repair hint sent to Cursor ───\n');
    console.log(formatCompletenessHintForCursor(report));
  }

  console.log(
    '\n  A deploy would run a Cursor cleanup round to fix these ' +
      '(or fail the revision outright when STRICT_COMPLETENESS_GATE=true).\n',
  );
  process.exit(1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(2);
});
