import {
  ModelCategory,
  ModelProvider,
  ModelTier,
} from './entities/ai-model.entity';

export interface SeedModel {
  modelId: string;
  provider: ModelProvider;
  displayName: string;
  tier: ModelTier;
  category: ModelCategory;
  enabled: boolean;
  isDefault: boolean;
  order: number;
  inputPerMillion: number;
  outputPerMillion: number;
  maxOutputTokens: number;
  contextTokens: number;
  codingOptimized: boolean;
}

/**
 * Provider-retired catalog ids. Forced `enabled: false` on every boot —
 * `$setOnInsert` would leave an existing admin-enabled row routing to a
 * 404. OpenAI shut `gpt-5-codex` down on 2026-07-23.
 */
export const RETIRED_MODEL_IDS: readonly string[] = ['gpt-5-codex'];

/**
 * Initial catalog. `onModuleInit` upserts these rows keyed by `modelId`,
 * but only `$set`s pricing/context fields so admin edits to
 * `enabled` / `displayName` / `order` / `isDefault` are preserved.
 *
 * Exactly one row must have `isDefault: true` — that's where "Auto"
 * routes when nothing more specific is requested. We pick Gemini 3.1 High
 * as the default per the product plan.
 */
export const MODEL_CATALOG_SEED: SeedModel[] = [
  {
    modelId: 'gemini-3-1-high',
    provider: 'google',
    displayName: 'Gemini 3.1 (High)',
    tier: 'high',
    category: 'coding',
    enabled: true,
    isDefault: true,
    order: 0,
    inputPerMillion: 1.25,
    outputPerMillion: 10,
    maxOutputTokens: 65000,
    contextTokens: 1_000_000,
    codingOptimized: true,
  },
  {
    modelId: 'claude-opus-4-7',
    provider: 'anthropic',
    displayName: 'Claude Opus 4.7',
    tier: 'high',
    category: 'coding',
    enabled: true,
    isDefault: false,
    order: 10,
    inputPerMillion: 15,
    outputPerMillion: 75,
    maxOutputTokens: 64000,
    contextTokens: 200_000,
    codingOptimized: true,
  },
  {
    modelId: 'claude-opus-4-6',
    provider: 'anthropic',
    displayName: 'Claude Opus 4.6',
    tier: 'high',
    category: 'coding',
    enabled: true,
    isDefault: false,
    order: 20,
    inputPerMillion: 15,
    outputPerMillion: 75,
    maxOutputTokens: 64000,
    contextTokens: 200_000,
    codingOptimized: true,
  },
  {
    modelId: 'claude-sonnet-4-6',
    provider: 'anthropic',
    displayName: 'Claude Sonnet 4.6',
    tier: 'medium',
    category: 'coding',
    enabled: true,
    isDefault: false,
    order: 30,
    inputPerMillion: 3,
    outputPerMillion: 15,
    maxOutputTokens: 64000,
    contextTokens: 200_000,
    codingOptimized: true,
  },
  {
    modelId: 'gpt-5-codex',
    provider: 'openai',
    displayName: 'GPT-5 Codex',
    tier: 'medium',
    category: 'coding',
    // OpenAI retired this id on 2026-07-23. Seed `enabled: false` only
    // applies on insert; `RETIRED_MODEL_IDS` force-disables existing rows.
    enabled: false,
    isDefault: false,
    order: 40,
    inputPerMillion: 2,
    outputPerMillion: 8,
    maxOutputTokens: 64000,
    contextTokens: 200_000,
    codingOptimized: true,
  },
  // Kept for back-compat — leave enabled so existing task-based routing
  // (plan/classify/extract) still has something to resolve to if pricing
  // admin disables every picker-visible row.
  {
    modelId: 'gpt-4o',
    provider: 'openai',
    displayName: 'GPT-4o',
    tier: 'medium',
    category: 'coding',
    enabled: true,
    isDefault: false,
    order: 100,
    inputPerMillion: 2.5,
    outputPerMillion: 10,
    maxOutputTokens: 8000,
    contextTokens: 128_000,
    codingOptimized: false,
  },
  {
    modelId: 'gpt-4o-mini',
    provider: 'openai',
    displayName: 'GPT-4o mini',
    tier: 'low',
    category: 'coding',
    enabled: true,
    isDefault: false,
    order: 110,
    inputPerMillion: 0.15,
    outputPerMillion: 0.6,
    maxOutputTokens: 4000,
    contextTokens: 128_000,
    codingOptimized: false,
  },
  {
    modelId: 'claude-sonnet-4-5',
    provider: 'anthropic',
    displayName: 'Claude Sonnet 4.5',
    tier: 'medium',
    category: 'coding',
    enabled: true,
    isDefault: false,
    order: 120,
    inputPerMillion: 3,
    outputPerMillion: 15,
    maxOutputTokens: 32000,
    contextTokens: 200_000,
    codingOptimized: false,
  },
  {
    modelId: 'claude-opus-4-5',
    provider: 'anthropic',
    displayName: 'Claude Opus 4.5',
    tier: 'high',
    category: 'coding',
    enabled: false,
    isDefault: false,
    order: 130,
    inputPerMillion: 5,
    outputPerMillion: 25,
    maxOutputTokens: 32000,
    contextTokens: 200_000,
    codingOptimized: false,
  },
];
