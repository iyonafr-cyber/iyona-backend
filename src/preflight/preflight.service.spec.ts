/**
 * The preflight gate decides whether a user is allowed to start a build at
 * all, so the cases that matter are the ones where it could be wrong in a
 * user-visible way: letting a build start into a quota-limited Cursor, or
 * locking someone out because our own ledger read hiccuped.
 */
import axios from 'axios';
import { PreflightService } from './preflight.service';
import type { AiProviderKeysService } from '../ai-provider-keys/ai-provider-keys.service';
import type { CreditsService } from '../credits/credits.service';
import type { ModelRouterService } from '../credits/model-router.service';

jest.mock('axios');

const mockedAxios = axios as jest.Mocked<typeof axios>;

function axiosErrorWithStatus(status: number) {
  return {
    isAxiosError: true,
    code: 'ERR_BAD_REQUEST',
    message: `Request failed with status code ${status}`,
    response: { status },
  };
}

function build(overrides?: {
  keys?: unknown[];
  balanceTotal?: number;
  balanceThrows?: boolean;
  /** Result of the live provider probe (`testKey`), keyed by key id. */
  probe?: { ok: boolean; message: string };
  probeByKeyId?: Record<string, { ok: boolean; message: string }>;
  /** Model the router resolves each build task to. */
  route?: { provider: string; model: string };
}) {
  const providerKeys = {
    loadRoutingSnapshot: jest.fn().mockResolvedValue({
      keys: overrides?.keys ?? [
        // Sorted by provider, so anthropic comes first — exactly the shape
        // that made the old keys[0] probe blame the wrong provider.
        { keyId: 'anthropic-1', provider: 'anthropic', apiKey: 'sk-a' },
        { keyId: 'openai-1', provider: 'openai', apiKey: 'sk-o' },
      ],
    }),
    testKey: jest.fn((keyId: string) =>
      Promise.resolve(
        overrides?.probeByKeyId?.[keyId] ??
          overrides?.probe ?? { ok: true, message: 'Provider accepted' },
      ),
    ),
  } as unknown as AiProviderKeysService;

  const modelRouter = {
    pickModel: jest
      .fn()
      .mockReturnValue(
        overrides?.route ?? { provider: 'openai', model: 'gpt-5-codex' },
      ),
  } as unknown as ModelRouterService;

  const credits = {
    getBalance: overrides?.balanceThrows
      ? jest.fn().mockRejectedValue(new Error('mongo down'))
      : jest.fn().mockResolvedValue({ total: overrides?.balanceTotal ?? 500 }),
  } as unknown as CreditsService;

  return new PreflightService(providerKeys, credits, modelRouter);
}

describe('PreflightService', () => {
  // The repo types `process.env`, so mutate the keys we care about rather
  // than swapping the whole object out.
  const ENV_KEYS = ['CURSOR_API_KEY', 'GITHUB_PAT', 'VERCEL_TOKEN'] as const;
  const ORIGINAL_ENV: Record<string, string | undefined> = {};

  beforeAll(() => {
    for (const k of ENV_KEYS) ORIGINAL_ENV[k] = process.env[k];
  });

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.CURSOR_API_KEY = 'ck_test';
    process.env.GITHUB_PAT = 'gh_test';
    process.env.VERCEL_TOKEN = 'vc_test';
    // Default: every upstream healthy. GitHub needs a rate_limit body.
    (mockedAxios.get as jest.Mock).mockImplementation((url: string) => {
      if (url.includes('api.github.com/rate_limit')) {
        return Promise.resolve({
          data: { resources: { core: { remaining: 4999 } } },
        });
      }
      return Promise.resolve({ data: {} });
    });
    // `isAxiosError` is a named export the service imports directly, so the
    // mock has to answer for the shapes we fabricate above.
    (mockedAxios as unknown as { isAxiosError: unknown }).isAxiosError = (
      e: unknown,
    ) => Boolean((e as { isAxiosError?: boolean })?.isAxiosError);
  });

  afterAll(() => {
    for (const k of ENV_KEYS) {
      if (ORIGINAL_ENV[k] === undefined) delete process.env[k];
      else process.env[k] = ORIGINAL_ENV[k];
    }
  });

  it('reports ready when every upstream answers', async () => {
    const result = await build().checkBuildReadiness('u1');
    expect(result.ready).toBe(true);
    expect(result.checks.map((c) => c.id).sort()).toEqual([
      'credits',
      'cursor',
      'github',
      'llm',
      'vercel',
    ]);
  });

  it('blocks the build when Cursor is rate limited', async () => {
    (mockedAxios.get as jest.Mock).mockImplementation((url: string) => {
      if (url.includes('api.cursor.com')) {
        return Promise.reject(axiosErrorWithStatus(429));
      }
      if (url.includes('api.github.com/rate_limit')) {
        return Promise.resolve({
          data: { resources: { core: { remaining: 4999 } } },
        });
      }
      return Promise.resolve({ data: {} });
    });

    const result = await build().checkBuildReadiness('u1');
    const cursor = result.checks.find((c) => c.id === 'cursor');

    expect(result.ready).toBe(false);
    expect(cursor).toMatchObject({
      status: 'down',
      reason: 'quota_exhausted',
      blocking: true,
    });
  });

  it('blocks when Cursor is out of budget (402)', async () => {
    (mockedAxios.get as jest.Mock).mockImplementation((url: string) =>
      url.includes('api.cursor.com')
        ? Promise.reject(axiosErrorWithStatus(402))
        : Promise.resolve({
            data: { resources: { core: { remaining: 4999 } } },
          }),
    );

    const result = await build().checkBuildReadiness('u1');
    expect(result.ready).toBe(false);
    expect(result.checks.find((c) => c.id === 'cursor')?.reason).toBe(
      'budget_exhausted',
    );
  });

  it('falls back to /v1/models when /v1/me is absent', async () => {
    (mockedAxios.get as jest.Mock).mockImplementation((url: string) => {
      if (url.endsWith('/v1/me')) {
        return Promise.reject(axiosErrorWithStatus(404));
      }
      if (url.includes('api.github.com/rate_limit')) {
        return Promise.resolve({
          data: { resources: { core: { remaining: 4999 } } },
        });
      }
      return Promise.resolve({ data: {} });
    });

    const result = await build().checkBuildReadiness('u1');
    expect(result.checks.find((c) => c.id === 'cursor')?.status).toBe('ok');
    expect(result.ready).toBe(true);
  });

  it('blocks when no healthy LLM provider key is configured', async () => {
    const result = await build({ keys: [] }).checkBuildReadiness('u1');
    expect(result.ready).toBe(false);
    expect(result.checks.find((c) => c.id === 'llm')).toMatchObject({
      status: 'down',
      reason: 'missing_config',
    });
  });

  it('blocks when the user cannot afford the whole build funnel', async () => {
    const result = await build({ balanceTotal: 3 }).checkBuildReadiness('u1');
    expect(result.ready).toBe(false);
    expect(result.checks.find((c) => c.id === 'credits')?.reason).toBe(
      'insufficient_credits',
    );
  });

  it('does not lock the user out when our own balance read fails', async () => {
    const result = await build({ balanceThrows: true }).checkBuildReadiness(
      'u1',
    );
    const credits = result.checks.find((c) => c.id === 'credits');
    expect(credits).toMatchObject({ status: 'degraded', blocking: false });
    expect(result.ready).toBe(true);
  });

  it('warns but still allows a build when GitHub quota runs low', async () => {
    (mockedAxios.get as jest.Mock).mockImplementation((url: string) =>
      url.includes('api.github.com/rate_limit')
        ? Promise.resolve({ data: { resources: { core: { remaining: 12 } } } })
        : Promise.resolve({ data: {} }),
    );

    const result = await build().checkBuildReadiness('u1');
    expect(result.checks.find((c) => c.id === 'github')?.status).toBe(
      'degraded',
    );
    expect(result.ready).toBe(true);
  });

  it('does not cache a failed sweep, so a recovery is picked up immediately', async () => {
    const service = build();

    (mockedAxios.get as jest.Mock).mockImplementation((url: string) =>
      url.includes('api.cursor.com')
        ? Promise.reject(axiosErrorWithStatus(429))
        : Promise.resolve({
            data: { resources: { core: { remaining: 4999 } } },
          }),
    );
    expect((await service.checkBuildReadiness('u1')).ready).toBe(false);

    // Cursor comes back — the very next call must see it, not a stale "down".
    (mockedAxios.get as jest.Mock).mockImplementation((url: string) =>
      url.includes('api.github.com/rate_limit')
        ? Promise.resolve({
            data: { resources: { core: { remaining: 4999 } } },
          })
        : Promise.resolve({ data: {} }),
    );
    expect((await service.checkBuildReadiness('u1')).ready).toBe(true);
  });

  it('reuses a clean sweep but never caches per-user credits', async () => {
    const service = build();
    await service.checkBuildReadiness('u1');
    const callsAfterFirst = (mockedAxios.get as jest.Mock).mock.calls.length;

    const second = await service.checkBuildReadiness('u1');

    // No new upstream probes…
    expect((mockedAxios.get as jest.Mock).mock.calls.length).toBe(
      callsAfterFirst,
    );
    // …but the balance was re-read, so a top-up takes effect right away.
    expect(second.checks.find((c) => c.id === 'credits')?.status).toBe('ok');
  });
  it('blocks when the Anthropic account balance is exhausted (400, not 402)', async () => {
    // The real incident. Note this can only be caught by a *metered* call:
    // a `GET /v1/models` listing answers 200 on a drained account, which is
    // why the probe delegates to testKey instead of listing models.
    const result = await build({
      probe: {
        ok: false,
        message:
          'HTTP 400: {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits."}}',
      },
    }).checkBuildReadiness('u1');

    const llm = result.checks.find((c) => c.id === 'llm');
    expect(result.ready).toBe(false);
    expect(llm).toMatchObject({
      status: 'down',
      reason: 'budget_exhausted',
      blocking: true,
    });
  });

  it('distinguishes a rate-limited provider from a broke one', async () => {
    const result = await build({
      probe: { ok: false, message: 'HTTP 429: rate limit exceeded' },
    }).checkBuildReadiness('u1');
    expect(result.checks.find((c) => c.id === 'llm')?.reason).toBe(
      'quota_exhausted',
    );
  });

  it('flags a rejected credential as unauthorized', async () => {
    const result = await build({
      probe: { ok: false, message: 'HTTP 401: invalid x-api-key' },
    }).checkBuildReadiness('u1');
    expect(result.checks.find((c) => c.id === 'llm')?.reason).toBe(
      'unauthorized',
    );
  });
  it('does not block on a dead provider the router never picks', async () => {
    // The live incident: Anthropic out of balance, GPT-5 Codex configured as
    // primary for both build tasks and perfectly healthy. The old check
    // probed loadRoutingSnapshot().keys[0] — and that snapshot sorts by
    // provider, so keys[0] was always the Anthropic key. A provider nothing
    // routes to must not be able to block a build.
    const service = build({
      route: { provider: 'openai', model: 'gpt-5-codex' },
      probeByKeyId: {
        'anthropic-1': {
          ok: false,
          message: 'HTTP 400: credit balance is too low',
        },
        'openai-1': { ok: true, message: 'Provider accepted (gpt-5-codex)' },
      },
    });

    const result = await service.checkBuildReadiness('u1');
    const llm = result.checks.find((c) => c.id === 'llm');

    expect(result.ready).toBe(true);
    expect(llm?.status).toBe('ok');
    // And it never spent a request on the provider it would not use.
    const testKey = (
      service as unknown as {
        providerKeys: { testKey: jest.Mock };
      }
    ).providerKeys.testKey;
    expect(testKey).not.toHaveBeenCalledWith('anthropic-1');
  });

  it('blocks when the provider the router DOES pick is out of budget', async () => {
    const result = await build({
      route: { provider: 'anthropic', model: 'claude-opus-4-8' },
      probeByKeyId: {
        'anthropic-1': {
          ok: false,
          message: 'HTTP 400: Your credit balance is too low',
        },
      },
    }).checkBuildReadiness('u1');

    expect(result.ready).toBe(false);
    expect(result.checks.find((c) => c.id === 'llm')).toMatchObject({
      status: 'down',
      reason: 'budget_exhausted',
    });
  });

  it('names the resolved models when everything is servable', async () => {
    const result = await build().checkBuildReadiness('u1');
    // Operators should be able to see WHICH models the gate cleared.
    expect(result.checks.find((c) => c.id === 'llm')?.detail).toContain(
      'gpt-5-codex',
    );
  });
});
