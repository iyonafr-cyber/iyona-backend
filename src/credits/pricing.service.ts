import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';
import { ModelCatalogService } from '../models/models.service';

export type Provider = 'openai' | 'anthropic' | 'google';

export interface ModelPrice {
  provider: Provider;
  model: string;
  /** USD per 1M input tokens. */
  inputPerMillion: number;
  /** USD per 1M output tokens. */
  outputPerMillion: number;
  /** Hard ceiling for output tokens we ever pass to the provider. */
  maxOutputTokens: number;
  /** Approx context window — used to warn when we're about to truncate prompts. */
  contextTokens: number;
}

/**
 * Provider cost table. All values are what Iyona *pays* — what the user
 * pays (via the credit price) is determined entirely by the Stripe plan
 * and is independent of this map.
 *
 * Update this table whenever provider pricing changes. The credit conversion
 * rate (1 credit = $0.01 internal cost) stays constant so changes here
 * automatically flow through.
 */
export const MODEL_PRICES: Record<string, ModelPrice> = {
  'gpt-4o': {
    provider: 'openai',
    model: 'gpt-4o',
    inputPerMillion: 2.5,
    outputPerMillion: 10,
    maxOutputTokens: 8000,
    contextTokens: 128000,
  },
  'gpt-4o-mini': {
    provider: 'openai',
    model: 'gpt-4o-mini',
    inputPerMillion: 0.15,
    outputPerMillion: 0.6,
    maxOutputTokens: 4000,
    contextTokens: 128000,
  },
  'claude-sonnet-4-5': {
    provider: 'anthropic',
    model: 'claude-sonnet-4-5',
    inputPerMillion: 3,
    outputPerMillion: 15,
    maxOutputTokens: 32000,
    contextTokens: 200000,
  },
  'claude-opus-4-5': {
    provider: 'anthropic',
    model: 'claude-opus-4-5',
    inputPerMillion: 5,
    outputPerMillion: 25,
    maxOutputTokens: 32000,
    contextTokens: 200000,
  },
  'claude-sonnet-4-6': {
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
    inputPerMillion: 3,
    outputPerMillion: 15,
    maxOutputTokens: 32000,
    contextTokens: 200000,
  },
  'claude-opus-4-6': {
    provider: 'anthropic',
    model: 'claude-opus-4-6',
    inputPerMillion: 15,
    outputPerMillion: 75,
    maxOutputTokens: 32000,
    contextTokens: 200000,
  },
  'claude-opus-4-7': {
    provider: 'anthropic',
    model: 'claude-opus-4-7',
    inputPerMillion: 15,
    outputPerMillion: 75,
    maxOutputTokens: 32000,
    contextTokens: 200000,
  },
  'gpt-5-codex': {
    provider: 'openai',
    model: 'gpt-5-codex',
    inputPerMillion: 2,
    outputPerMillion: 8,
    maxOutputTokens: 32000,
    contextTokens: 200000,
  },
  'gemini-3-1-high': {
    provider: 'google',
    model: 'gemini-3-1-high',
    inputPerMillion: 1.25,
    outputPerMillion: 10,
    maxOutputTokens: 32000,
    contextTokens: 1000000,
  },
};

/** 1 credit represents $0.01 of internal provider cost. */
export const CREDIT_USD_VALUE = 0.01;

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  model: string;
  provider: Provider;
}

@Injectable()
export class PricingService {
  private readonly logger = new Logger(PricingService.name);

  private readonly marginMultiplier = Math.max(
    1,
    Number(process.env.CREDITS_MARGIN_MULTIPLIER ?? 1),
  );

  constructor(
    @Inject(forwardRef(() => ModelCatalogService))
    private readonly catalog: ModelCatalogService,
  ) {}

  /**
   * Lookup order:
   *   1. In-memory model catalog (admin-editable pricing).
   *   2. Static `MODEL_PRICES` map (safety net — guarantees commit-credits
   *      still works even if a row was deleted mid-request).
   *   3. Cheapest static entry (log + warn to surface misconfiguration).
   */
  getPrice(model: string): ModelPrice {
    const fromCatalog = this.catalog?.get(model);
    if (fromCatalog) {
      return {
        provider: fromCatalog.provider,
        model: fromCatalog.modelId,
        inputPerMillion: fromCatalog.inputPerMillion,
        outputPerMillion: fromCatalog.outputPerMillion,
        maxOutputTokens: fromCatalog.maxOutputTokens,
        contextTokens: fromCatalog.contextTokens,
      };
    }
    const price = MODEL_PRICES[model];
    if (!price) {
      this.logger.warn(
        `Unknown model ${model}; falling back to gpt-4o-mini pricing`,
      );
      return MODEL_PRICES['gpt-4o-mini'];
    }
    return price;
  }

  /**
   * Upper-bound credit estimate used for reservation. We assume the entire
   * `maxOutputTokens` budget will be spent AND that the input is close to
   * what the caller declared. The result is intentionally pessimistic so
   * reservations never under-charge; the delta is refunded after the call.
   */
  estimateCredits(params: {
    model: string;
    estimatedInputTokens: number;
    maxOutputTokens: number;
  }): number {
    const price = this.getPrice(params.model);
    const inputCost =
      (params.estimatedInputTokens * price.inputPerMillion) / 1_000_000;
    const outputCost =
      (params.maxOutputTokens * price.outputPerMillion) / 1_000_000;
    const totalCostUsd = (inputCost + outputCost) * this.marginMultiplier;
    // Always round up so we never reserve less than what could actually be spent.
    return Math.max(1, Math.ceil(totalCostUsd / CREDIT_USD_VALUE));
  }

  /**
   * Compute the exact credit cost from observed usage. Returns integer
   * credits rounded UP (so sub-credit costs never round to zero and give
   * away free calls).
   */
  computeCredits(usage: TokenUsage): { credits: number; usdCost: number } {
    const price = this.getPrice(usage.model);
    const usdCost =
      (usage.inputTokens * price.inputPerMillion +
        usage.outputTokens * price.outputPerMillion) /
      1_000_000;
    const scaledCost = usdCost * this.marginMultiplier;
    const credits = Math.max(1, Math.ceil(scaledCost / CREDIT_USD_VALUE));
    return { credits, usdCost };
  }

  /**
   * Rough token count for a text string. We use the 4-chars-per-token
   * heuristic everyone has converged on — good enough for *reservation*
   * estimates (real usage is authoritative).
   */
  estimateTokensFromText(text: string): number {
    if (!text) return 0;
    return Math.max(1, Math.ceil(text.length / 4));
  }
}
