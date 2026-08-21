import type { Model } from 'mongoose';
import type { RepoService } from 'src/repo/repo.service';
import type { Revision } from 'src/revisions/entities/revision.entity';
import { CursorService } from './cursor.service';
import type { AdminSettingsService } from '../admin/settings/admin-settings.service';

/**
 * Covers how `askCodebaseQuestion` resolves the agent's FINAL answer: the SSE
 * `result` event, the GET-run fallback when the stream is unusable, and
 * terminal runs that produced no reply.
 */

const AGENT_ID = 'bc-test-agent';
const RUN_ID = 'run-test-run';

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

interface Routes {
  stream?: () => unknown;
  run?: () => unknown;
}

function mockFetch(routes: Routes): {
  fetch: typeof fetch;
  calls: string[];
} {
  const calls: string[] = [];
  const impl = (
    input: unknown,
    init?: { method?: string },
  ): Promise<unknown> => {
    const url = String(input);
    calls.push(`${init?.method ?? 'GET'} ${url}`);

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
    if (url.endsWith('/cancel')) {
      return Promise.resolve(jsonResponse({}));
    }
    if (url.includes('/runs/')) {
      return Promise.resolve(
        routes.run?.() ?? jsonResponse({ status: 'FINISHED', result: '' }),
      );
    }
    throw new Error(`unexpected fetch: ${url}`);
  };
  return { fetch: impl as unknown as typeof fetch, calls };
}

function newService(): CursorService {
  return new CursorService(
    {} as Model<Revision>,
    {} as RepoService,
    {
      // No configured coding model → CursorService falls back to the env id.
      get: () => Promise.resolve({ cursorAgentModelId: null }),
    } as unknown as AdminSettingsService,
  );
}

describe('CursorService.askCodebaseQuestion', () => {
  const realFetch = global.fetch;

  beforeAll(() => {
    process.env.CURSOR_API_KEY = 'test-key';
    process.env.CURSOR_ASK_TIMEOUT_MS = '20000';
  });

  afterEach(() => {
    global.fetch = realFetch;
  });

  const ask = (service: CursorService) =>
    service.askCodebaseQuestion({
      projectId: 'p1',
      owner: 'acme',
      repo: 'shop',
      question: 'Does this app have an admin feature?',
    });

  it('returns the final reply from the SSE result event', async () => {
    const { fetch: f, calls } = mockFetch({
      stream: () =>
        sseResponse(
          [
            'event: status\ndata: {"runId":"run-test-run","status":"RUNNING"}\n',
            'event: assistant\ndata: {"text":"Let me look."}\n',
            'event: result\ndata: {"runId":"run-test-run","status":"FINISHED","text":"Yes. The app has an admin dashboard.","durationMs":9000}\n',
            'event: done\ndata: {}\n',
          ].join('\n'),
        ),
      run: () =>
        jsonResponse({
          status: 'FINISHED',
          result: 'Yes. The app has an admin dashboard.',
          durationMs: 9000,
        }),
    });
    global.fetch = f;

    const result = await ask(newService());

    expect(result.status).toBe('answered');
    expect(result.answer).toBe('Yes. The app has an admin dashboard.');
    expect(result.runStatus).toBe('FINISHED');
    expect(result.durationMs).toBe(9000);
    expect(result.agentId).toBe(AGENT_ID);
    // Read-only: the agent must not be asked to open a PR.
    expect(calls).toContain('POST https://api.cursor.com/v1/agents');
  });

  it('does not request a pull request for a question run', async () => {
    let body = '';
    const base = mockFetch({
      stream: () => sseResponse('event: done\ndata: {}\n'),
      run: () => jsonResponse({ status: 'FINISHED', result: 'No.' }),
    });
    global.fetch = ((input: unknown, init?: { body?: string }) => {
      if (String(input).endsWith('/v1/agents')) body = init?.body ?? '';
      return base.fetch(input as string, init as RequestInit);
    }) as unknown as typeof fetch;

    await ask(newService());

    const parsed = JSON.parse(body) as {
      autoCreatePR: boolean;
      prompt: { text: string };
    };
    expect(parsed.autoCreatePR).toBe(false);
    expect(parsed.prompt.text).toContain('READ-ONLY');
    expect(parsed.prompt.text).toContain(
      'Does this app have an admin feature?',
    );
  });

  it('falls back to GET run when the stream is unusable', async () => {
    const { fetch: f, calls } = mockFetch({
      stream: () => jsonResponse({ error: 'stream_expired' }, false, 410),
      run: () =>
        jsonResponse({
          status: 'FINISHED',
          result: 'No. There is no admin area.',
          durationMs: 4200,
        }),
    });
    global.fetch = f;

    const result = await ask(newService());

    expect(result.status).toBe('answered');
    expect(result.answer).toBe('No. There is no admin area.');
    expect(calls.filter((c) => c.includes('/runs/')).length).toBeGreaterThan(0);
  });

  it('prefers partial streamed text when a terminal run has no result', async () => {
    const { fetch: f } = mockFetch({
      stream: () =>
        sseResponse(
          'event: assistant\ndata: {"text":"Yes, there is an admin page."}\n',
        ),
      run: () => jsonResponse({ status: 'FINISHED', result: '' }),
    });
    global.fetch = f;

    const result = await ask(newService());

    expect(result.status).toBe('answered');
    expect(result.answer).toBe('Yes, there is an admin page.');
  });

  it('reports failure with user-safe copy when the run errors with no reply', async () => {
    const { fetch: f } = mockFetch({
      stream: () =>
        sseResponse(
          'event: error\ndata: {"code":"agent_error","message":"boom"}\n',
        ),
      run: () => jsonResponse({ status: 'ERROR', result: '' }),
    });
    global.fetch = f;

    const result = await ask(newService());

    expect(result.status).toBe('failed');
    expect(result.answer).toMatch(/couldn't read your app/i);
    expect(result.runStatus).toBe('ERROR');
  });

  it('reports failure when the agent cannot be created', async () => {
    global.fetch = (() =>
      Promise.resolve(
        jsonResponse({ error: 'forbidden' }, false, 403),
      )) as unknown as typeof fetch;

    const result = await ask(newService());

    expect(result.status).toBe('failed');
    expect(result.agentId).toBeUndefined();
  });
});
