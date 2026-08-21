import type { LoggerService } from '@nestjs/common';
import { VercelService } from './vercel.service';

describe('VercelService.filterEnvVars', () => {
  // filterEnvVars only ever calls `warn`, but the parameter is typed as the
  // full LoggerService — stub the rest so the suite compiles.
  const logger = {
    warn: jest.fn(),
    log: jest.fn(),
    error: jest.fn(),
  } satisfies Partial<LoggerService> as unknown as LoggerService & {
    warn: jest.Mock;
  };

  beforeEach(() => {
    logger.warn.mockClear();
  });

  it('keeps allowlisted keys and drops NODE_ / unknown', () => {
    const out = VercelService.filterEnvVars(
      {
        VITE_OK: '1',
        NODE_OPTIONS: '--inspect',
        SECRET: 'x',
      },
      'proj1',
      logger,
    );
    expect(out).toEqual({ VITE_OK: '1' });
  });

  it('returns undefined when nothing survives filtering', () => {
    const out = VercelService.filterEnvVars({ SECRET: 'x' }, 'proj1', logger);
    expect(out).toBeUndefined();
  });

  it('drops server-only Supabase credentials despite the SUPABASE_ prefix', () => {
    // Decision 07 — a database URL pasted into the Secrets panel must never
    // reach a build env, where it would sit readable in the Vercel dashboard.
    const out = VercelService.filterEnvVars(
      {
        VITE_SUPABASE_URL: 'https://x.supabase.co',
        SUPABASE_DB_URL: 'postgresql://postgres:pw@host:5432/postgres',
        SUPABASE_SERVICE_ROLE_KEY: 'service-role',
      },
      'proj1',
      logger,
    );
    expect(out).toEqual({ VITE_SUPABASE_URL: 'https://x.supabase.co' });
  });
});
