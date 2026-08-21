import { Controller, Get } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckService,
  MongooseHealthIndicator,
} from '@nestjs/terminus';
import { SkipThrottle } from '@nestjs/throttler';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Public } from '../auth/decorator/public.decorator';

// Resolve package version once at module load. We read package.json with fs
// instead of `import` so we don't need `resolveJsonModule` and so the same
// code works whether the process is launched via `nest start` (cwd = project
// root) or `node dist/main` (cwd = dist).
const PKG_VERSION: string = (() => {
  const candidates = [
    join(__dirname, '..', '..', 'package.json'),
    join(process.cwd(), 'package.json'),
  ];
  for (const path of candidates) {
    try {
      const raw = readFileSync(path, 'utf8');
      const parsed = JSON.parse(raw) as { version?: string };
      if (parsed.version) return parsed.version;
    } catch {
      // try next candidate
    }
  }
  return 'unknown';
})();

const PROCESS_STARTED_AT = new Date().toISOString();

/**
 * Liveness/readiness probes for orchestrators (Kubernetes, ECS, Vercel) and
 * uptime monitors. Kept public on purpose so probes don't need credentials.
 */
@Controller('health')
@Public()
@SkipThrottle()
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly mongo: MongooseHealthIndicator,
  ) {}

  @Get()
  @HealthCheck()
  check() {
    return this.health.check([() => this.mongo.pingCheck('mongodb')]);
  }

  @Get('live')
  liveness() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.round(process.uptime()),
    };
  }

  @Get('version')
  version() {
    // Commit SHA is injected at build/deploy time. Most providers expose a
    // standard env var, so we try them in order and fall back to a generic
    // GIT_COMMIT_SHA for self-hosted setups.
    const commit =
      process.env.GIT_COMMIT_SHA ??
      process.env.VERCEL_GIT_COMMIT_SHA ??
      process.env.RENDER_GIT_COMMIT ??
      process.env.HEROKU_SLUG_COMMIT ??
      process.env.SOURCE_VERSION ??
      'unknown';

    const branch =
      process.env.GIT_BRANCH ??
      process.env.VERCEL_GIT_COMMIT_REF ??
      process.env.RENDER_GIT_BRANCH ??
      'unknown';

    return {
      name: 'iyona-backend',
      version: PKG_VERSION,
      commit,
      commitShort: commit === 'unknown' ? 'unknown' : commit.slice(0, 7),
      branch,
      environment: process.env.NODE_ENV ?? 'development',
      buildTime: process.env.BUILD_TIME ?? null,
      startedAt: PROCESS_STARTED_AT,
      uptimeSeconds: Math.round(process.uptime()),
      node: process.version,
      now: new Date().toISOString(),
    };
  }
}
