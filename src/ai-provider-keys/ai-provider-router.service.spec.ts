import { AiProviderRouterService } from './ai-provider-router.service';
import type {
  AiProviderKeysService,
  ResolvedProviderKey,
} from './ai-provider-keys.service';

function key(partial: Partial<ResolvedProviderKey>): ResolvedProviderKey {
  return {
    keyId: 'key',
    provider: 'anthropic',
    apiKey: 'secret',
    priority: 100,
    ...partial,
  };
}

describe('AiProviderRouterService', () => {
  it('checks model-level availability using supportedModels', async () => {
    const keys = {
      getCacheGeneration: jest.fn().mockReturnValue(1),
      loadRoutingSnapshot: jest.fn().mockResolvedValue({
        keys: [key({ keyId: 'anthropic-1', provider: 'anthropic' })],
        supportedByKeyId: new Map([['anthropic-1', ['claude-sonnet-4-5']]]),
      }),
    } as unknown as AiProviderKeysService;

    const router = new AiProviderRouterService(keys);

    await expect(
      router.isModelAvailable('anthropic', 'claude-sonnet-4-5'),
    ).resolves.toBe(true);
    await expect(
      router.isModelAvailable('anthropic', 'claude-opus-4-5'),
    ).resolves.toBe(false);
  });

  it('treats empty supportedModels as any model for the provider', async () => {
    const keys = {
      getCacheGeneration: jest.fn().mockReturnValue(1),
      loadRoutingSnapshot: jest.fn().mockResolvedValue({
        keys: [key({ keyId: 'openai-1', provider: 'openai' })],
        supportedByKeyId: new Map([['openai-1', []]]),
      }),
    } as unknown as AiProviderKeysService;

    const router = new AiProviderRouterService(keys);

    await expect(router.isModelAvailable('openai', 'gpt-4o')).resolves.toBe(
      true,
    );
  });
});
