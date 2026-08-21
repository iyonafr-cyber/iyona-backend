import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { AiProviderRouterService } from '../ai-provider-keys/ai-provider-router.service';
import { MODEL_PRICES, Provider } from './pricing.service';
import { ModelCatalogService } from '../models/models.service';
import { TaskRouteService } from '../models/task-routes.service';
import type { RouterTaskName } from '../models/entities/ai-task-route.entity';

/**
 * Canonical definition now lives in `models/entities/ai-task-route.entity`
 * so the admin routing config can own it without an import cycle. Re-exported
 * here because call sites across the codebase import `RouterTask` from this
 * module.
 */
export type RouterTask = RouterTaskName;

/** Which precedence layer produced a {@link RouteDecision}. */
export type RouteSource =
  | 'request'
  | 'projectDefault'
  | 'taskRoutePrimary'
  | 'taskRouteFallback'
  | 'globalDefault'
  | 'legacyTable';

export interface RouteDecision {
  provider: Provider;
  model: string;
  maxOutputTokens: number;
  /** True when the provider isn't available and we fell back elsewhere. */
  fellBack: boolean;
  /** Precedence layer that chose this model. Diagnostic only. */
  source?: RouteSource;
}

export interface PickModelOverride {
  /** Per-request pick from the UI picker. `'auto'` or undefined = no override. */
  modelId?: string;
  /** `UserProject.defaultModelId` — applied when there's no per-request pick. */
  projectDefaultModelId?: string;
}

interface RouteRule {
  /** Preferred model in priority order. First available wins. */
  candidates: string[];
  maxOutputTokens: number;
}

const ROUTES: Record<RouterTask, RouteRule> = {
  classify: { candidates: ['gpt-4o-mini'], maxOutputTokens: 1000 },
  extract: { candidates: ['gpt-4o-mini'], maxOutputTokens: 2000 },
  plan: {
    candidates: ['gpt-4o', 'claude-sonnet-4-5'],
    maxOutputTokens: 4000,
  },
  reason: {
    candidates: ['claude-sonnet-4-5', 'gpt-4o'],
    maxOutputTokens: 4000,
  },
};

/**
 * Inputs larger than this threshold promote a `reason`/`plan` call to Opus
 * (when available) because Sonnet's accuracy drops on very long contexts.
 */
const OPUS_PROMOTION_TOKEN_THRESHOLD = 80_000;

@Injectable()
export class ModelRouterService {
  private readonly logger = new Logger(ModelRouterService.name);

  constructor(
    private readonly catalog: ModelCatalogService,
    private readonly providerKeys: AiProviderRouterService,
    private readonly taskRoutes: TaskRouteService,
  ) {}

  private providerConfigured(provider: Provider): boolean {
    return this.providerKeys.getLastAvailabilitySync()[provider];
  }

  /** Enabled, not retired, and backed by a live provider key. */
  private isRoutable(modelId: string): boolean {
    const row = this.catalog.get(modelId);
    return (
      !!row &&
      row.enabled &&
      !row.deprecatedAt &&
      this.providerConfigured(row.provider)
    );
  }

  /**
   * Resolve the model to use for a request. Precedence (first match wins):
   *
   *   0. admin task route with `enforce: true` — platform-level override
   *   1. `override.modelId` — per-request picker choice (Cursor-style UI)
   *   2. `override.projectDefaultModelId` — per-project default
   *   3. admin task route (primary → fallback chain) for this task
   *   4. `catalog.getDefault()` — the row marked `isDefault: true` (= Auto)
   *   5. task-based fallback — the historic `ROUTES` table
   *
   * Layers 0 and 3 are the same admin-configured chain; `enforce` only
   * decides whether it sits above or below the user's own pick. Either way
   * it outranks the global "Auto" default, so a task-specific choice is
   * never silently swallowed by it.
   *
   * Whichever branch fires, the returned `RouteDecision` is a full snapshot
   * of the routing choice — everything the call needs to hit a provider
   * without consulting the catalog again. This is the foundation of the
   * non-interruption guarantee: the catalog can mutate (admin toggles,
   * deletes) but the in-flight request keeps its snapshot.
   */
  pickModel(
    task: RouterTask,
    hints: { estimatedInputTokens?: number } = {},
    override: PickModelOverride = {},
  ): RouteDecision {
    const rule = ROUTES[task];
    const configured = this.taskRoutes.get(task);

    if (configured?.enforce) {
      const enforced = this.resolveTaskRoute(task, rule.maxOutputTokens);
      if (enforced) return enforced;
    }

    const chosen = this.resolveOverride(override, rule.maxOutputTokens);
    if (chosen) return chosen;

    const fromTaskRoute = this.resolveTaskRoute(task, rule.maxOutputTokens);
    if (fromTaskRoute) return fromTaskRoute;

    const globalDefault = this.resolveGlobalDefault(rule.maxOutputTokens);
    if (globalDefault) return globalDefault;

    return this.taskFallback(task, rule, hints);
  }

  /**
   * Walk the admin-configured chain for `task`, returning the first
   * candidate that is present in the catalog, enabled, and backed by a
   * healthy provider key. Returns null when the task is unconfigured or
   * every candidate is unavailable — the caller then continues down the
   * precedence chain, so a bad config degrades rather than fails.
   */
  private resolveTaskRoute(
    task: RouterTask,
    maxOutputTokens: number,
  ): RouteDecision | null {
    const candidates = this.taskRoutes.candidates(task);
    if (candidates.length === 0) return null;

    const skipped: string[] = [];
    for (const [index, modelId] of candidates.entries()) {
      const row = this.catalog.get(modelId);
      if (!row || !this.isRoutable(modelId)) {
        skipped.push(modelId);
        continue;
      }
      if (skipped.length > 0) {
        // Explicit: the previous silent Gemini→gpt-4o style degradation is
        // exactly the failure mode this config exists to make visible.
        this.logger.warn(
          `[TaskRoute] task=${task} skipped [${skipped.join(', ')}] ` +
            `(disabled or provider unavailable) — using ${modelId}`,
        );
      }
      return {
        provider: row.provider,
        model: row.modelId,
        maxOutputTokens,
        fellBack: index > 0,
        source: index === 0 ? 'taskRoutePrimary' : 'taskRouteFallback',
      };
    }

    this.logger.warn(
      `[TaskRoute] task=${task} has no available candidate ` +
        `([${candidates.join(', ')}]) — falling through to default routing`,
    );
    return null;
  }

  /**
   * Resolution for layers 1–2 of the precedence chain above. Returns null
   * when no override applies — callers fall through to task routing.
   *
   * Layer 1 (per-request) throws on an explicitly-picked model that's
   * disabled / missing / provider-unavailable. That's the desired UX: if
   * the user insists on Opus but Opus is down we want them to see a
   * clear 400 rather than silently getting Sonnet.
   *
   * Layer 2 (project default) falls through on any problem — it's a hint,
   * not a command.
   */
  private resolveOverride(
    override: PickModelOverride,
    maxOutputTokens: number,
  ): RouteDecision | null {
    const requested = override.modelId?.trim();
    if (requested && requested !== 'auto') {
      const row = this.catalog.get(requested);
      if (!row) {
        throw new BadRequestException(`Unsupported model: ${requested}`);
      }
      if (row.deprecatedAt) {
        // Distinct from "disabled": the admin didn't turn this off, the
        // provider stopped serving it. Same 400 either way, but a support
        // ticket quoting this message points at the right fix.
        throw new BadRequestException(
          `Model no longer available from its provider: ${requested}`,
        );
      }
      if (!row.enabled) {
        throw new BadRequestException(`Model disabled: ${requested}`);
      }
      if (!this.providerConfigured(row.provider)) {
        throw new BadRequestException(
          `Provider not configured for model: ${requested}`,
        );
      }
      return {
        provider: row.provider,
        model: row.modelId,
        maxOutputTokens,
        fellBack: false,
        source: 'request',
      };
    }

    const projectDefault = override.projectDefaultModelId?.trim();
    if (projectDefault && projectDefault !== 'auto') {
      const row = this.catalog.get(projectDefault);
      if (row && this.isRoutable(projectDefault)) {
        return {
          provider: row.provider,
          model: row.modelId,
          maxOutputTokens,
          fellBack: false,
          source: 'projectDefault',
        };
      }
    }

    return null;
  }

  /** Layer 4 — the catalog row flagged `isDefault` (the "Auto" target). */
  private resolveGlobalDefault(maxOutputTokens: number): RouteDecision | null {
    const globalDefault = this.catalog.getDefault();
    if (globalDefault && this.isRoutable(globalDefault.modelId)) {
      return {
        provider: globalDefault.provider,
        model: globalDefault.modelId,
        maxOutputTokens,
        fellBack: false,
        source: 'globalDefault',
      };
    }
    return null;
  }

  private taskFallback(
    task: RouterTask,
    rule: RouteRule,
    hints: { estimatedInputTokens?: number },
  ): RouteDecision {
    const candidates = [...rule.candidates];

    if (
      (task === 'reason' || task === 'plan') &&
      (hints.estimatedInputTokens ?? 0) >= OPUS_PROMOTION_TOKEN_THRESHOLD &&
      this.providerConfigured('anthropic')
    ) {
      candidates.unshift('claude-opus-4-5');
    }

    let fellBack = false;
    for (const model of candidates) {
      const price = MODEL_PRICES[model];
      if (!price) continue;
      if (!this.providerConfigured(price.provider)) {
        fellBack = true;
        continue;
      }
      return {
        provider: price.provider,
        model,
        maxOutputTokens: rule.maxOutputTokens,
        fellBack,
        source: 'legacyTable',
      };
    }

    const fallbackModel = this.providerConfigured('openai')
      ? 'gpt-4o-mini'
      : this.providerConfigured('anthropic')
        ? 'claude-sonnet-4-5'
        : this.providerConfigured('google')
          ? 'gemini-3-1-high'
          : null;

    if (!fallbackModel) {
      throw new Error(
        'No AI provider configured — add active provider keys in the admin panel',
      );
    }

    this.logger.warn(
      `No preferred candidate available for task=${task}; falling back to ${fallbackModel}`,
    );

    const price = MODEL_PRICES[fallbackModel];
    return {
      provider: price.provider,
      model: fallbackModel,
      maxOutputTokens: rule.maxOutputTokens,
      fellBack: true,
      source: 'legacyTable',
    };
  }
}
