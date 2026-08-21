import type { Model } from 'mongoose';
import type { RepoService } from 'src/repo/repo.service';
import type { Revision } from 'src/revisions/entities/revision.entity';
import { CursorService } from './cursor.service';
import type { AdminSettingsService } from '../admin/settings/admin-settings.service';

/**
 * Covers the workspace-chat round (`runStandaloneUserPromptRound`) carrying the
 * agent's final reply. When the agent answers a question it opens no PR, so that
 * reply is the only result — dropping it is what used to surface in chat as
 * "No changes were applied".
 */

const AGENT_ID = 'bc-chat-agent';
const RUN_ID = 'run-chat-run';

function sseResponse(body: string): unknown {
  const chunks = [new TextEncoder().encode(body)];
  let i = 0;
  return {
    ok: true,
    status: 200,
    body: {
      getReader: () => ({
        read: () =>
          Promise.resolve(
            i < chunks.length
              ? { done: false, value: chunks[i++] }
              : { done: true, value: undefined },
          ),
        releaseLock: () => undefined,
      }),
    },
  };
}

function jsonResponse(payload: unknown, ok = true, status = 200): unknown {
  return {
    ok,
    status,
    text: () => Promise.resolve(JSON.stringify(payload)),
  };
}

function mockFetch(routes: { stream?: () => unknown; run?: () => unknown }) {
  const impl = (input: unknown): Promise<unknown> => {
    const url = String(input);
    if (url.endsWith('/v1/agents')) {
      return Promise.resolve(
        jsonResponse({ agent: { id: AGENT_ID }, run: { id: RUN_ID } }),
      );
    }
    if (url.endsWith('/stream')) {
      return Promise.resolve(
        routes.stream?.() ?? jsonResponse({ error: 'no stream' }, false, 500),
      );
    }
    if (url.includes('/runs/')) {
      return Promise.resolve(
        routes.run?.() ?? jsonResponse({ status: 'FINISHED', result: '' }),
      );
    }
    throw new Error(`unexpected fetch: ${url}`);
  };
  return impl as unknown as typeof fetch;
}

/** No open PR from the agent branch → the agent changed nothing. */
function repoServiceWithoutPr(): RepoService {
  return {
    findOpenPrForBranch: jest.fn().mockResolvedValue(null),
  } as unknown as RepoService;
}

function newService(repoService: RepoService): CursorService {
  return new CursorService({} as Model<Revision>, repoService, {
    // No configured coding model → CursorService falls back to the env id.
    get: () => Promise.resolve({ cursorAgentModelId: null }),
  } as unknown as AdminSettingsService);
}

describe('CursorService.runStandaloneUserPromptRound', () => {
  const realFetch = global.fetch;

  beforeAll(() => {
    process.env.CURSOR_API_KEY = 'test-key';
    // The round races the stream against a run-timeout sleep; keep that timer
    // short so it does not hold the jest process open after the test resolves.
    process.env.CURSOR_RUN_TIMEOUT_MS = '3000';
  });

  afterEach(() => {
    global.fetch = realFetch;
  });

  const run = (service: CursorService, userPrompt: string) =>
    service.runStandaloneUserPromptRound({
      projectId: 'p1',
      owner: 'acme',
      repo: 'shop',
      userPrompt,
    });

  it('returns no_changes with the answer when the prompt was a question', async () => {
    global.fetch = mockFetch({
      stream: () =>
        sseResponse(
          [
            'event: assistant',
            'data: {"text":"Let me look at the routes."}',
            '',
            'event: result',
            'data: {"text":"Yes. There is an admin dashboard at /admin for managing products and orders."}',
            '',
          ].join('\n'),
        ),
    });

    const result = await run(
      newService(repoServiceWithoutPr()),
      'Does this app have an admin feature?',
    );

    expect(result.status).toBe('no_changes');
    expect(result.prNumber).toBeUndefined();
    expect(result.mergedSha).toBeUndefined();
    expect(result.agentMessage).toBe(
      'Yes. There is an admin dashboard at /admin for managing products and orders.',
    );
  });

  it('falls back to the run result when the stream carried no reply', async () => {
    global.fetch = mockFetch({
      stream: () => sseResponse('event: assistant\ndata: {"text":""}\n\n'),
      run: () =>
        jsonResponse({
          status: 'FINISHED',
          result:
            'No. The app has no admin area — there are only public pages.',
        }),
    });

    const result = await run(
      newService(repoServiceWithoutPr()),
      'Is there an admin panel?',
    );

    expect(result.status).toBe('no_changes');
    expect(result.agentMessage).toBe(
      'No. The app has no admin area — there are only public pages.',
    );
  });

  it('leaves agentMessage undefined when the agent said nothing', async () => {
    global.fetch = mockFetch({
      stream: () => sseResponse('event: result\ndata: {"text":"  "}\n\n'),
    });

    const result = await run(
      newService(repoServiceWithoutPr()),
      'add a footer',
    );

    expect(result.status).toBe('no_changes');
    expect(result.agentMessage).toBeUndefined();
  });
});
