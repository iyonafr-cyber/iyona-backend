/* eslint-disable no-console */
/**
 * Validate GitHub PAT used by RepoService (spec-build, deploy, Cursor handoff).
 *
 * Token resolution matches production:
 *   GITHUB_PAT → JARVIS_GITHUB_TOKEN
 * Optional org: JARVIS_GITHUB_ORG (when set, also checks org access).
 *
 * Usage:
 *   npm run github:validate-pat
 *   npm run github:validate-pat -- --env=/path/to/.env
 *
 * Never prints the full token. Exit 0 = OK, 1 = misconfigured or invalid.
 */
import * as fs from 'fs';
import * as path from 'path';
import { Octokit } from '@octokit/rest';

type EnvMap = Record<string, string>;

function parseEnvFile(file: string): EnvMap {
  const out: EnvMap = {};
  if (!fs.existsSync(file)) return out;
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
    out[key] = val;
  }
  return out;
}

function parseArgs(): { envFile: string } {
  const repoRoot = path.resolve(__dirname, '..');
  let envFile = path.join(repoRoot, '.env');
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--env=')) envFile = path.resolve(arg.slice('--env='.length));
  }
  return { envFile };
}

function maskToken(token: string): string {
  if (token.length <= 10) return '***';
  return `${token.slice(0, 4)}…${token.slice(-4)}`;
}

/** Same precedence as RepoService. */
function resolvePat(env: EnvMap): { token: string; source: string } {
  const pat = env.GITHUB_PAT?.trim();
  if (pat) return { token: pat, source: 'GITHUB_PAT' };
  const jarvis = env.JARVIS_GITHUB_TOKEN?.trim();
  if (jarvis) return { token: jarvis, source: 'JARVIS_GITHUB_TOKEN' };
  return { token: '', source: '' };
}

async function validateToken(
  token: string,
  org: string,
  label: string,
): Promise<boolean> {
  console.log(`\n── ${label} ──`);
  console.log(`Token preview: ${maskToken(token)}`);

  const octokit = new Octokit({ auth: token });

  try {
    const { data } = await octokit.users.getAuthenticated();
    console.log(`OK: authenticated as ${data.login}`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`FAIL: GitHub rejected the token — ${msg}`);
    return false;
  }

  if (!org) {
    console.log('OK: personal-account mode (no GITHUB_ORG)');
    return true;
  }

  try {
    const { data } = await octokit.orgs.get({ org });
    console.log(`OK: org "${data.login}" is reachable`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`FAIL: cannot access org "${org}" — ${msg}`);
    return false;
  }

  try {
    await octokit.request('HEAD /orgs/{org}/repos', { org, per_page: 1 });
    console.log(`OK: can list repos in org "${org}"`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`FAIL: cannot list org repos — ${msg}`);
    return false;
  }

  return true;
}

async function main(): Promise<void> {
  const { envFile } = parseArgs();
  const fileEnv = parseEnvFile(envFile);

  console.log(`Env file: ${envFile}`);

  const { token: fileToken, source } = resolvePat(fileEnv);
  const org =
    fileEnv.GITHUB_ORG?.trim() || fileEnv.JARVIS_GITHUB_ORG?.trim() || '';

  if (!fileToken) {
    console.error(
      'FAIL: No token in .env. Set GITHUB_PAT or JARVIS_GITHUB_TOKEN.',
    );
    process.exit(1);
  }

  console.log(`Token source (.env): ${source}`);
  console.log(
    `Org mode: ${org ? `GITHUB_ORG=${org}` : '(none — repos under PAT user)'}`,
  );

  const shellPat = process.env.GITHUB_PAT?.trim();
  const shellJarvis = process.env.JARVIS_GITHUB_TOKEN?.trim();
  const shellToken = shellPat || shellJarvis || '';
  const shellSource = shellPat
    ? 'GITHUB_PAT'
    : shellJarvis
      ? 'JARVIS_GITHUB_TOKEN'
      : '';

  if (shellToken && shellToken !== fileToken) {
    console.warn(
      `\nWARN: Shell env has a different ${shellSource} (${maskToken(shellToken)}) than .env (${maskToken(fileToken)}).`,
    );
    console.warn(
      'NestJS ConfigModule does not override existing shell vars — restart with `unset GITHUB_PAT JARVIS_GITHUB_TOKEN` or fix your shell profile.',
    );
  }

  const fileOk = await validateToken(fileToken, org, '.env token');
  if (!fileOk) {
    console.error(
      '\nHint: generate a new classic PAT with "repo" scope, or a fine-grained token with repo + org access.',
    );
    process.exit(1);
  }

  if (shellToken && shellToken !== fileToken) {
    const shellOk = await validateToken(
      shellToken,
      org,
      'shell token (what a naive restart would use)',
    );
    if (!shellOk) {
      console.error(
        '\nFAIL: .env token is valid but shell token is not. Unset shell vars before starting the backend.',
      );
      process.exit(1);
    }
  }

  console.log('\nAll checks passed.');
}

main().catch((err: unknown) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
