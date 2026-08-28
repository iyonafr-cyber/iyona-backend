/**
 * The coding model must come from the admin dashboard, not a redeploy.
 *
 * It is resolved per run rather than cached in the constructor: an admin
 * switching the model has to affect the next build. These tests pin the
 * precedence (admin setting → CURSOR_AGENT_MODEL_ID → composer-2), the
 * fallback when the settings read fails, and the shape of the model params
 * (effort/reasoning/…) attached to the agent create body.
 */
import { Model } from 'mongoose';
import { CursorService } from './cursor.service';
import type { RepoService } from '../repo/repo.service';
import type { AdminSettingsService } from '../admin/settings/admin-settings.service';
import type { Revision } from '../revisions/entities/revision.entity';

function serviceWith(settings: unknown): CursorService {
  return new CursorService(
    {} as Model<Revision>,
    {} as RepoService,
    settings as AdminSettingsService,
  );
}

function resolve(
  service: CursorService,
): Promise<{ id: string; params?: Array<{ id: string; value: string }> }> {
  return (
    service as unknown as {
      resolveModelSelection: () => Promise<{
        id: string;
        params?: Array<{ id: string; value: string }>;
      }>;
    }
  ).resolveModelSelection();
}

describe('CursorService coding-model resolution', () => {
  const ORIGINAL = process.env.CURSOR_AGENT_MODEL_ID;
  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.CURSOR_AGENT_MODEL_ID;
    else process.env.CURSOR_AGENT_MODEL_ID = ORIGINAL;
  });

  it('uses the admin-configured model over the env default', async () => {
    process.env.CURSOR_AGENT_MODEL_ID = 'composer-2';
    const service = serviceWith({
      get: () => Promise.resolve({ cursorAgentModelId: 'claude-4-sonnet' }),
    });
    await expect(resolve(service)).resolves.toEqual({
      id: 'claude-4-sonnet',
    });
  });

  it('attaches admin-configured model params in Cursor {id,value} shape', async () => {
    process.env.CURSOR_AGENT_MODEL_ID = 'composer-2';
    const service = serviceWith({
      get: () =>
        Promise.resolve({
          cursorAgentModelId: 'claude-opus-5',
          cursorAgentModelParams: { effort: 'high', fast: 'true', blank: ' ' },
        }),
    });
    await expect(resolve(service)).resolves.toEqual({
      id: 'claude-opus-5',
      params: [
        { id: 'effort', value: 'high' },
        { id: 'fast', value: 'true' },
      ],
    });
  });

  it('never attaches params to the env-fallback model', async () => {
    process.env.CURSOR_AGENT_MODEL_ID = 'gpt-5';
    const service = serviceWith({
      get: () =>
        Promise.resolve({
          cursorAgentModelId: null,
          cursorAgentModelParams: { effort: 'max' },
        }),
    });
    await expect(resolve(service)).resolves.toEqual({ id: 'gpt-5' });
  });

  it('falls back to the env id when nothing is configured', async () => {
    process.env.CURSOR_AGENT_MODEL_ID = 'gpt-5';
    const service = serviceWith({
      get: () => Promise.resolve({ cursorAgentModelId: null }),
    });
    await expect(resolve(service)).resolves.toEqual({ id: 'gpt-5' });
  });

  it('ignores a blank setting rather than sending an empty model id', async () => {
    process.env.CURSOR_AGENT_MODEL_ID = 'gpt-5';
    const service = serviceWith({
      get: () => Promise.resolve({ cursorAgentModelId: '   ' }),
    });
    await expect(resolve(service)).resolves.toEqual({ id: 'gpt-5' });
  });

  it('still builds when the settings read fails', async () => {
    process.env.CURSOR_AGENT_MODEL_ID = 'composer-2';
    const service = serviceWith({
      get: () => Promise.reject(new Error('mongo down')),
    });
    await expect(resolve(service)).resolves.toEqual({ id: 'composer-2' });
  });
});
