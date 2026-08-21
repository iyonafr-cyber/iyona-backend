import { Injectable, Logger } from '@nestjs/common';
import axios, { AxiosError } from 'axios';
import { AiProviderRouterService } from '../ai-provider-keys/ai-provider-router.service';
import { SeedModel } from './model-catalog.seed';
import { ModelProvider } from './entities/ai-model.entity';
import { isNonChatModelId } from './non-chat-model';

export interface RemoteModel {
  modelId: string;
  provider: ModelProvider;
  /**
   * Publish date as reported by the provider. Anthropic exposes `created_at`
   * and OpenAI a `created` epoch; Google's list endpoint reports neither, so
   * Gemini rows come back undefined.
   */
  releasedAt?: Date;
}

/** One provider's answer to a catalog refresh. */
interface ProviderFetch {
  /**
   * False when the provider has no configured key, errored, or timed out.
   * Kept separate from `models.length === 0` because the two mean opposite
   * things to the caller: an empty *answer* retires models, an absent one
   * must not.
   */
  responded: boolean;
  models: RemoteModel[];
}

export interface CatalogFetchResult {
  models: RemoteModel[];
  /**
   * Providers that actually answered. A provider with no key, or whose call
   * failed, is absent — it cannot testify to what it no longer serves, and
   * refresh now *writes* deprecation rather than only reporting it, so
   * guessing here would retire a live model on a network blip.
   */
  respondedProviders: ModelProvider[];
}

/** Guard against a malformed/absent provider timestamp reaching Mongo. */
function toDate(value: string | number | undefined): Date | undefined {
  if (value === undefined || value === null) return undefined;
  const d =
    typeof value === 'number' ? new Date(value * 1000) : new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/**
 * Thin adapter over each provider's model-catalog endpoint. Used by the
 * admin "Refresh from providers" button. Every call is defensive: a
 * single provider being down must not break the refresh overall.
 */
@Injectable()
export class ProviderCatalogService {
  private readonly logger = new Logger(ProviderCatalogService.name);

  /**
   * Only coding-capable families. Anything else is noise for our picker.
   *
   * Match on *family*, never on generation number. These previously pinned
   * generations (`claude-…-[34]`, `gpt-[45]`, `gemini-(2|3)`), which meant
   * every new model release was invisible to Refresh until someone edited
   * this file — `claude-opus-5` and `claude-opus-4-8` were both being
   * silently dropped. A too-broad match is harmless because discovered rows
   * land `enabled: false` and need explicit admin approval; a too-narrow one
   * makes new models unreachable.
   */
  private readonly codingPatterns: Record<ModelProvider, RegExp> = {
    openai: /^(gpt-\d|o\d|codex)/i,
    anthropic: /^claude-(sonnet|opus|haiku)-\d/i,
    google: /^gemini-\d/i,
  };

  constructor(private readonly providerRouter: AiProviderRouterService) {}

  async fetchAll(): Promise<CatalogFetchResult> {
    await this.providerRouter.ensureCache();
    const [openai, anthropic, google] = await Promise.all([
      this.fetchOpenAI(),
      this.fetchAnthropic(),
      this.fetchGoogle(),
    ]);
    const byProvider: Array<[ModelProvider, ProviderFetch]> = [
      ['openai', openai],
      ['anthropic', anthropic],
      ['google', google],
    ];
    return {
      models: byProvider.flatMap(([, result]) => result.models),
      respondedProviders: byProvider
        .filter(([, result]) => result.responded)
        .map(([provider]) => provider),
    };
  }

  private async fetchOpenAI(): Promise<ProviderFetch> {
    const key = await this.providerRouter.getAnyKeyForProvider('openai');
    if (!key) return { responded: false, models: [] };
    try {
      const base =
        key.openaiBaseUrl?.trim()?.replace(/\/$/, '') ||
        'https://api.openai.com/v1';
      const res = await axios.get<{
        data: Array<{ id: string; created?: number }>;
      }>(`${base}/models`, {
        headers: { Authorization: `Bearer ${key.apiKey}` },
        timeout: 10_000,
      });
      const models = (res.data?.data ?? [])
        .filter(
          (m) =>
            this.codingPatterns.openai.test(m.id) && !isNonChatModelId(m.id),
        )
        .map((m) => ({
          modelId: m.id,
          provider: 'openai' as const,
          releasedAt: toDate(m.created),
        }));
      return { responded: true, models };
    } catch (err) {
      this.warn('openai', err);
      return { responded: false, models: [] };
    }
  }

  private async fetchAnthropic(): Promise<ProviderFetch> {
    const key = await this.providerRouter.getAnyKeyForProvider('anthropic');
    if (!key) return { responded: false, models: [] };
    try {
      const res = await axios.get<{
        data: Array<{ id: string; created_at?: string }>;
      }>('https://api.anthropic.com/v1/models', {
        headers: {
          'x-api-key': key.apiKey,
          'anthropic-version': '2023-06-01',
        },
        timeout: 10_000,
      });
      const models = (res.data?.data ?? [])
        .filter(
          (m) =>
            this.codingPatterns.anthropic.test(m.id) && !isNonChatModelId(m.id),
        )
        .map((m) => ({
          modelId: m.id,
          provider: 'anthropic' as const,
          releasedAt: toDate(m.created_at),
        }));
      return { responded: true, models };
    } catch (err) {
      this.warn('anthropic', err);
      return { responded: false, models: [] };
    }
  }

  private async fetchGoogle(): Promise<ProviderFetch> {
    const key = await this.providerRouter.getAnyKeyForProvider('google');
    if (!key) return { responded: false, models: [] };
    try {
      const res = await axios.get<{
        models: Array<{ name: string; supportedGenerationMethods?: string[] }>;
      }>(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key.apiKey)}`,
        { timeout: 10_000 },
      );
      const models = (res.data?.models ?? [])
        .filter(
          (m) =>
            m.supportedGenerationMethods?.includes('generateContent') ?? true,
        )
        .map((m) => m.name.replace(/^models\//, ''))
        .filter(
          (id) => this.codingPatterns.google.test(id) && !isNonChatModelId(id),
        )
        .map((id) => ({ modelId: id, provider: 'google' as const }));
      return { responded: true, models };
    } catch (err) {
      this.warn('google', err);
      return { responded: false, models: [] };
    }
  }

  /**
   * Suggest pricing/limits for a freshly-discovered model. Providers
   * don't publish prices in these catalog endpoints, so we pick
   * reasonable defaults per tier. Admin edits override later.
   */
  suggestDefaults(
    id: string,
    provider: ModelProvider,
  ): Omit<SeedModel, 'modelId' | 'provider' | 'order' | 'isDefault'> {
    const looksHigh = /opus|ultra|high|pro/i.test(id);
    const looksLow = /mini|nano|flash/i.test(id);
    const tier: SeedModel['tier'] = looksHigh
      ? 'high'
      : looksLow
        ? 'low'
        : 'medium';
    const [input, output] =
      provider === 'google'
        ? [1.25, 10]
        : provider === 'anthropic'
          ? looksHigh
            ? [15, 75]
            : [3, 15]
          : looksHigh
            ? [5, 25]
            : looksLow
              ? [0.15, 0.6]
              : [2, 8];
    return {
      displayName: id,
      tier,
      // Newly-discovered rows are matched by the provider-catalog
      // "coding patterns" regex above, so they are coding by default.
      // Admins can re-classify in the /admin/models UI.
      category: 'coding',
      enabled: false,
      inputPerMillion: input,
      outputPerMillion: output,
      maxOutputTokens: 32_000,
      contextTokens: provider === 'google' ? 1_000_000 : 200_000,
      codingOptimized: true,
    };
  }

  private warn(provider: string, err: unknown): void {
    const message =
      err instanceof AxiosError
        ? err.response?.status
          ? `HTTP ${err.response.status}`
          : err.message
        : err instanceof Error
          ? err.message
          : 'unknown';
    this.logger.warn(`Failed to fetch ${provider} model catalog: ${message}`);
  }
}
