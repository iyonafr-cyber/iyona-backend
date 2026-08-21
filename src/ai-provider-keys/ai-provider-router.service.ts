import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { Provider } from '../credits/pricing.service';
import {
  AiProviderKeysService,
  type ResolvedProviderKey,
} from './ai-provider-keys.service';
import type { AiProviderKeyProvider } from './entities/ai-provider-key.entity';

const CACHE_TTL_MS = 45_000;

interface CacheEntry {
  expiresAt: number;
  keys: ResolvedProviderKey[];
  supportedByKeyId: Map<string, string[]>;
  generation: number;
}

@Injectable()
export class AiProviderRouterService implements OnModuleInit {
  private readonly logger = new Logger(AiProviderRouterService.name);
  private cache: CacheEntry | null = null;
  private lastAvailability: Record<Provider, boolean> = {
    openai: false,
    anthropic: false,
    google: false,
  };

  constructor(private readonly keys: AiProviderKeysService) {}

  async onModuleInit(): Promise<void> {
    await this.ensureCache();
  }

  /** Snapshot for sync model routing (refreshed with cache TTL). */
  getLastAvailabilitySync(): Record<Provider, boolean> {
    return { ...this.lastAvailability };
  }

  private refreshLastAvailability(): void {
    const list = this.cache?.keys ?? [];
    this.lastAvailability = {
      openai: list.some((k) => k.provider === 'openai'),
      anthropic: list.some((k) => k.provider === 'anthropic'),
      google: list.some((k) => k.provider === 'google'),
    };
  }

  private async refreshCacheLocked(): Promise<void> {
    const generation = this.keys.getCacheGeneration();
    const { keys, supportedByKeyId } = await this.keys.loadRoutingSnapshot();

    this.cache = {
      expiresAt: Date.now() + CACHE_TTL_MS,
      keys,
      supportedByKeyId,
      generation,
    };
    this.refreshLastAvailability();
    this.logger.debug(
      `Provider key cache refreshed (${keys.length} active healthy keys)`,
    );
  }

  async ensureCache(): Promise<void> {
    const gen = this.keys.getCacheGeneration();
    if (
      !this.cache ||
      Date.now() > this.cache.expiresAt ||
      this.cache.generation !== gen
    ) {
      await this.refreshCacheLocked();
    }
  }

  /** Provider has at least one routable healthy key. */
  async isProviderConfigured(provider: Provider): Promise<boolean> {
    await this.ensureCache();
    return this.cache.keys.some((k) => k.provider === provider);
  }

  async providerAvailability(): Promise<Record<Provider, boolean>> {
    await this.ensureCache();
    const list = this.cache.keys;
    return {
      openai: list.some((k) => k.provider === 'openai'),
      anthropic: list.some((k) => k.provider === 'anthropic'),
      google: list.some((k) => k.provider === 'google'),
    };
  }

  async isModelAvailable(
    provider: AiProviderKeyProvider,
    modelId: string,
  ): Promise<boolean> {
    const candidates = await this.getCandidatesForModel(provider, modelId);
    return candidates.length > 0;
  }

  /**
   * Keys eligible for this provider + model, highest priority first
   * (lowest numeric priority value first).
   */
  async getCandidatesForModel(
    provider: AiProviderKeyProvider,
    modelId: string,
  ): Promise<ResolvedProviderKey[]> {
    await this.ensureCache();
    const list = this.cache.keys.filter((k) => k.provider === provider);
    const supported = this.cache.supportedByKeyId;

    const eligible = list.filter((k) => {
      const models = supported.get(k.keyId) ?? [];
      if (models.length === 0) return true;
      return models.includes(modelId);
    });

    eligible.sort(
      (a, b) => a.priority - b.priority || a.keyId.localeCompare(b.keyId),
    );
    return eligible;
  }

  /** First key for quick health checks / catalog fetch (any model). */
  async getAnyKeyForProvider(
    provider: AiProviderKeyProvider,
  ): Promise<ResolvedProviderKey | null> {
    await this.ensureCache();
    const list = this.cache.keys
      .filter((k) => k.provider === provider)
      .sort(
        (a, b) => a.priority - b.priority || a.keyId.localeCompare(b.keyId),
      );
    return list[0] ?? null;
  }
}
