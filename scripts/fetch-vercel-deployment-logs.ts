/**
 * Smoke-test Vercel API connectivity by fetching deployment build logs.
 * Mirrors `VercelService.getDeploymentLogs` (GET /v2/deployments/{id}/events).
 *
 * Requires:
 *   - VERCEL_TOKEN (same as the Nest app)
 *   - VERCEL_TEAM_ID (optional; include if your token is team-scoped)
 *
 * Usage:
 *   npm run vercel:deployment-logs
 *   npm run vercel:deployment-logs -- dpl_otherId
 *   DEPLOYMENT_ID=dpl_xxx npm run vercel:deployment-logs
 *
 * Flags:
 *   --json   print raw response body (truncated if huge) for debugging
 *   --full   print entire decoded log (default: head + tail summary)
 */
import 'dotenv/config';
import axios from 'axios';

const DEFAULT_DEPLOYMENT_ID = 'dpl_24qnSZL5bZMpppTcUJv7HfvjSvYT';

function parseArgs(): {
  deploymentId: string;
  json: boolean;
  full: boolean;
} {
  const rest = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const flags = new Set(process.argv.slice(2).filter((a) => a.startsWith('--')));
  const fromEnv = process.env.DEPLOYMENT_ID?.trim();
  const fromArg = rest[0]?.trim();
  return {
    deploymentId: fromArg || fromEnv || DEFAULT_DEPLOYMENT_ID,
    json: flags.has('--json'),
    full: flags.has('--full'),
  };
}

/** Same parsing logic as `src/vercel/vercel.service.ts` `getDeploymentLogs`. */
function parseEventsBody(raw: string): string {
  const lines: string[] = [];
  const trimmed = raw.trim();
  if (trimmed.startsWith('[')) {
    let events: unknown[];
    try {
      events = JSON.parse(trimmed) as unknown[];
    } catch {
      events = [];
    }
    for (const ev of events) {
      if (!ev || typeof ev !== 'object') continue;
      const o = ev as Record<string, unknown>;
      if (o.type === 'stdout' || o.type === 'stderr') {
        const payload = o.payload as Record<string, unknown> | undefined;
        const text = String(
          (payload?.text as string) ??
            o.text ??
            o.message ??
            '',
        );
        if (text) lines.push(text);
      }
    }
  } else {
    for (const line of trimmed.split('\n')) {
      if (!line.trim()) continue;
      try {
        const ev = JSON.parse(line) as Record<string, unknown>;
        if (ev.type === 'stdout' || ev.type === 'stderr') {
          const payload = ev.payload as Record<string, unknown> | undefined;
          const text = String(
            (payload?.text as string) ??
              ev.text ??
              ev.message ??
              '',
          );
          if (text) lines.push(text);
        }
      } catch {
        lines.push(line);
      }
    }
  }
  return lines.join('\n');
}

async function main(): Promise<void> {
  const { deploymentId, json, full } = parseArgs();
  const token = process.env.VERCEL_TOKEN?.trim();
  if (!token) {
    console.error('Missing VERCEL_TOKEN (set in .env or export in shell).');
    process.exit(1);
  }

  const teamId = process.env.VERCEL_TEAM_ID?.trim();
  const params: Record<string, string> = { direction: 'forward' };
  if (teamId) params.teamId = teamId;

  const url = `https://api.vercel.com/v2/deployments/${encodeURIComponent(deploymentId)}/events`;

  console.log(`GET ${url}`);
  console.log(`teamId query: ${teamId || '(none)'}`);
  console.log('---');

  try {
    const response = await axios.get<string>(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      params,
      responseType: 'text',
      validateStatus: () => true,
    });

    console.log(`HTTP ${response.status} ${response.statusText || ''}`);

    if (response.status >= 400) {
      console.error('Body:', String(response.data).slice(0, 4000));
      process.exit(1);
    }

    const raw =
      typeof response.data === 'string'
        ? response.data
        : JSON.stringify(response.data);

    if (json) {
      const preview = raw.length > 50000 ? `${raw.slice(0, 50000)}\n… [truncated]` : raw;
      console.log(preview);
      process.exit(0);
    }

    const decoded = parseEventsBody(raw);
    console.log(
      `Decoded stdout/stderr lines (joined length): ${decoded.length} chars`,
    );

    if (!decoded.trim()) {
      console.log(
        '(No stdout/stderr lines parsed — events may use other types, or body empty. Try --json.)',
      );
    } else if (full) {
      console.log('--- log ---');
      console.log(decoded);
    } else {
      const max = 4000;
      if (decoded.length <= max) {
        console.log('--- log ---');
        console.log(decoded);
      } else {
        const head = decoded.slice(0, max / 2);
        const tail = decoded.slice(-max / 2);
        console.log('--- log (head) ---');
        console.log(head);
        console.log('\n… [middle omitted; use --full] …\n');
        console.log('--- log (tail) ---');
        console.log(tail);
      }
    }

    console.log('---');
    console.log('OK: server can reach Vercel deployment events API.');
  } catch (err: unknown) {
    const ax = err as { response?: { status?: number; data?: unknown }; message?: string };
    const msg =
      ax.response?.data != null
        ? JSON.stringify(ax.response.data)
        : ax.message || String(err);
    console.error('Request failed:', msg);
    process.exit(1);
  }
}

void main();
