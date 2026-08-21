import { Injectable, Logger } from '@nestjs/common';
import axios, { isAxiosError } from 'axios';
import { AiProviderKeysService } from '../ai-provider-keys/ai-provider-keys.service';
import { ModelRouterService } from '../credits/model-router.service';
import type {
  RouteDecision,
  RouterTask,
} from '../credits/model-router.service';
import { CreditsService } from '../credits/credits.service';
import { CREDIT_ACTIONS } from '../credits/constants/credit-actions';
import type {
  PreflightCheck,
  PreflightReason,
  PreflightResult,
} from './preflight.types';

/**
 * Credits needed to walk a first build end to end: validate the idea, ask the
 * questionnaire, then write the build spec that Cursor executes. Derived from
 * the catalogue instead of hardcoded so a repricing can't silently make this
 * gate wrong.
 */
const FIRST_BUILD_MIN_CREDITS =
  CREDIT_ACTIONS.validate.minReserve +
  CREDIT_ACTIONS.questionnaire.minReserve +
  CREDIT_ACTIONS.build_spec.minReserve;

/** Upstream probes get a short leash — this runs while the user waits. */
const PROBE_TIMEOUT_MS = 6_000;

/**
 * How long a successful upstream sweep is reused. Long enough that mashing
 * "Create" doesn't hammer four external APIs, short enough that a quota reset
 * is picked up without a restart.
 */
const CACHE_TTL_MS = 30_000;

/** Below this many GitHub API calls left, we warn but don't block. */
const GITHUB_LOW_RATE_LIMIT = 100;

@Injectable()
export class PreflightService {
  private readonly logger = new Logger(PreflightService.name);

  /**
   * Cache for the *shared* upstream checks only. Per-user credits are never
   * cached — a user who tops up mid-session must not be told they're broke.
   */
  private cache: { at: number; checks: PreflightCheck[] } | null = null;

  constructor(
    private readonly providerKeys: AiProviderKeysService,
    private readonly credits: CreditsService,
    private readonly modelRouter: ModelRouterService,
  ) {}

  /**
   * Full readiness sweep for "can this user start a build right now".
   */
  async checkBuildReadiness(userId: string): Promise<PreflightResult> {
    const now = Date.now();
    const cached =
      this.cache && now - this.cache.at < CACHE_TTL_MS ? this.cache : null;

    const shared = cached
      ? cached.checks
      : await Promise.all([
          this.checkCursor(),
          this.checkLlmProvider(),
          this.checkGithub(),
          this.checkVercel(),
        ]);

    // Only cache a clean sweep. Caching a failure would keep the door shut
    // for 30s after the upstream recovers, which is exactly when a user is
    // retrying.
    if (!cached && shared.every((c) => c.status === 'ok')) {
      this.cache = { at: now, checks: shared };
    } else if (!cached) {
      this.cache = null;
    }

    const checks = [...shared, await this.checkCredits(userId)];
    const ready = !checks.some((c) => c.blocking && c.status === 'down');

    if (!ready) {
      this.logger.warn(
        `[Preflight] Build blocked for user ${userId}: ` +
          checks
            .filter((c) => c.blocking && c.status === 'down')
            .map((c) => `${c.id}(${c.reason ?? 'unknown'})`)
            .join(', '),
      );
    }

    return {
      ready,
      checks,
      checkedAt: new Date(cached ? cached.at : now).toISOString(),
    };
  }

  /** Drop the cached sweep — used after an operator fixes a key. */
  invalidate(): void {
    this.cache = null;
  }

  /**
   * Cursor Background Agents API. This is the one most likely to be the
   * problem: it is the only upstream with both a per-key rate limit and a
   * spend cap, and it is the step that authors the entire app.
   */
  private async checkCursor(): Promise<PreflightCheck> {
    const base = (
      process.env.CURSOR_API_BASE_URL ?? 'https://api.cursor.com'
    ).replace(/\/+$/, '');
    const apiKey = process.env.CURSOR_API_KEY?.trim() ?? '';

    if (!apiKey) {
      return {
        id: 'cursor',
        label: 'Cursor build agent',
        status: 'down',
        blocking: true,
        reason: 'missing_config',
        detail: 'CURSOR_API_KEY is not set',
      };
    }

    const auth = `Basic ${Buffer.from(`${apiKey}:`, 'utf8').toString('base64')}`;

    // `/v1/me` is the cheapest authenticated call on the agents API. If a
    // deployment is pinned to an older surface that lacks it, fall back to
    // `/v1/models` rather than reporting a false outage.
    for (const path of ['/v1/me', '/v1/models']) {
      try {
        await axios.get(`${base}${path}`, {
          headers: { Accept: 'application/json', Authorization: auth },
          timeout: PROBE_TIMEOUT_MS,
        });
        return {
          id: 'cursor',
          label: 'Cursor build agent',
          status: 'ok',
          blocking: true,
        };
      } catch (e) {
        const status = isAxiosError(e) ? e.response?.status : undefined;
        if (status === 404 && path === '/v1/me') continue; // try the fallback
        return {
          id: 'cursor',
          label: 'Cursor build agent',
          ...this.classifyHttpFailure(e, status),
          blocking: true,
        };
      }
    }

    return {
      id: 'cursor',
      label: 'Cursor build agent',
      status: 'down',
      blocking: true,
      reason: 'unreachable',
      detail: 'No usable Cursor probe endpoint responded',
    };
  }

  /**
   * Can the build's LLM steps actually be served?
   *
   * NOT "is some key healthy". The previous version probed
   * `loadRoutingSnapshot().keys[0]`, and that snapshot sorts by
   * `provider: 1` — so `keys[0]` was always the Anthropic key when one
   * existed. An exhausted Anthropic balance therefore reported the whole
   * provider layer offline and blocked every build, while GPT-5 Codex sat
   * there as the configured primary for both tasks, healthy, ready to serve.
   *
   * What matters is per task, not per key: the router already walks the
   * admin's chain (primary → fallbacks → global default → static fallback)
   * skipping anything whose provider has no healthy key. So we ask the
   * router which model each build task resolves to, then probe only the
   * providers it actually chose. A dead key on a provider nothing routes to
   * is not an outage.
   */
  private async checkLlmProvider(): Promise<PreflightCheck> {
    const label = 'AI model provider';

    // The funnel: validate + questionnaire are `classify`, the execution
    // plan and the build spec are `plan`. Both must be servable to finish.
    const tasks: RouterTask[] = ['classify', 'plan'];

    let routes: { task: RouterTask; route: RouteDecision }[];
    try {
      routes = tasks.map((task) => ({
        task,
        route: this.modelRouter.pickModel(task),
      }));
    } catch (e) {
      // pickModel throws only when nothing anywhere can serve the task.
      return {
        id: 'llm',
        label,
        status: 'down',
        blocking: true,
        reason: 'missing_config',
        detail: e instanceof Error ? e.message : 'no model available',
      };
    }

    // One probe per distinct provider the router actually picked — not one
    // per key, and never a provider we would not use.
    const providers = [...new Set(routes.map((r) => r.route.provider))];
    const failures: string[] = [];

    for (const provider of providers) {
      const keyId = await this.firstHealthyKeyId(provider);
      if (!keyId) {
        failures.push(`${provider}: no healthy key`);
        continue;
      }
      const probe = await this.providerKeys.testKey(keyId);
      if (!probe.ok) failures.push(`${provider}: ${probe.message}`);
    }

    if (failures.length === 0) {
      return {
        id: 'llm',
        label,
        status: 'ok',
        blocking: true,
        detail: routes.map((r) => `${r.task}→${r.route.model}`).join(', '),
      };
    }

    // Every provider the build would use is unusable.
    const joined = failures.join('; ');
    return {
      id: 'llm',
      label,
      status: 'down',
      blocking: true,
      reason: this.classifyProbeMessage(joined),
      detail: joined.slice(0, 300),
    };
  }

  /** Healthy key for one provider, in routing priority order. */
  private async firstHealthyKeyId(provider: string): Promise<string | null> {
    try {
      const { keys } = await this.providerKeys.loadRoutingSnapshot();
      return keys.find((k) => k.provider === provider)?.keyId ?? null;
    } catch {
      return null;
    }
  }

  /** Map a provider probe message onto the reason the user needs to hear. */
  private classifyProbeMessage(message: string): PreflightReason {
    const msg = message.toLowerCase();
    if (
      msg.includes('credit balance is too low') ||
      msg.includes('purchase credits') ||
      msg.includes('insufficient_quota') ||
      msg.includes('billing')
    ) {
      return 'budget_exhausted';
    }
    if (msg.includes('http 429')) return 'quota_exhausted';
    if (msg.includes('http 401') || msg.includes('http 403')) {
      return 'unauthorized';
    }
    if (msg.includes('no healthy key')) return 'missing_config';
    return 'unreachable';
  }

  /**
   * GitHub hosts the repo Cursor works in. `/rate_limit` is free (it does not
   * consume quota itself) and answers both questions at once: is the token
   * valid, and do we have calls left to seed a repo.
   */
  private async checkGithub(): Promise<PreflightCheck> {
    // Generic GITHUB_PAT; legacy JARVIS_GITHUB_TOKEN kept as a fallback (Bucket B).
    const token =
      process.env.GITHUB_PAT?.trim() ||
      process.env.JARVIS_GITHUB_TOKEN?.trim() ||
      '';

    if (!token) {
      return {
        id: 'github',
        label: 'GitHub',
        status: 'down',
        blocking: true,
        reason: 'missing_config',
        detail: 'No GitHub token configured (GITHUB_PAT)',
      };
    }

    try {
      const res = await axios.get<{
        resources?: { core?: { remaining?: number } };
      }>('https://api.github.com/rate_limit', {
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${token}`,
        },
        timeout: PROBE_TIMEOUT_MS,
      });

      const remaining = res.data?.resources?.core?.remaining;
      if (typeof remaining === 'number' && remaining <= 0) {
        return {
          id: 'github',
          label: 'GitHub',
          status: 'down',
          blocking: true,
          reason: 'quota_exhausted',
          detail: 'GitHub core rate limit exhausted',
        };
      }
      if (typeof remaining === 'number' && remaining < GITHUB_LOW_RATE_LIMIT) {
        return {
          id: 'github',
          label: 'GitHub',
          status: 'degraded',
          blocking: true,
          reason: 'quota_exhausted',
          detail: `Only ${remaining} GitHub API calls remaining`,
        };
      }
      return { id: 'github', label: 'GitHub', status: 'ok', blocking: true };
    } catch (e) {
      const status = isAxiosError(e) ? e.response?.status : undefined;
      return {
        id: 'github',
        label: 'GitHub',
        ...this.classifyHttpFailure(e, status),
        blocking: true,
      };
    }
  }

  /**
   * Vercel deploys the finished app. It runs last in the build, but a dead
   * token here still means the user watches a full build complete and then
   * lands on nothing — so it blocks like the rest.
   */
  private async checkVercel(): Promise<PreflightCheck> {
    const token = process.env.VERCEL_TOKEN?.trim() ?? '';
    if (!token) {
      return {
        id: 'vercel',
        label: 'Vercel deployments',
        status: 'down',
        blocking: true,
        reason: 'missing_config',
        detail: 'VERCEL_TOKEN is not set',
      };
    }

    try {
      await axios.get('https://api.vercel.com/v2/user', {
        headers: { Authorization: `Bearer ${token}` },
        timeout: PROBE_TIMEOUT_MS,
      });
      return {
        id: 'vercel',
        label: 'Vercel deployments',
        status: 'ok',
        blocking: true,
      };
    } catch (e) {
      const status = isAxiosError(e) ? e.response?.status : undefined;
      return {
        id: 'vercel',
        label: 'Vercel deployments',
        ...this.classifyHttpFailure(e, status),
        blocking: true,
      };
    }
  }

  /**
   * The user's own balance. Checked against the whole first-build funnel, not
   * just the next call — starting a build you can only half-afford is the
   * same interrupted-mid-flow failure this whole gate exists to prevent.
   */
  private async checkCredits(userId: string): Promise<PreflightCheck> {
    try {
      const balance = await this.credits.getBalance(userId);
      if (balance.total < FIRST_BUILD_MIN_CREDITS) {
        return {
          id: 'credits',
          label: 'Your credits',
          status: 'down',
          blocking: true,
          reason: 'insufficient_credits',
          detail: `${balance.total} available, ${FIRST_BUILD_MIN_CREDITS} needed to finish a build`,
        };
      }
      return {
        id: 'credits',
        label: 'Your credits',
        status: 'ok',
        blocking: true,
      };
    } catch (e) {
      // A ledger read failure is our bug, not the user's — don't lock them
      // out of the product over it.
      this.logger.error(
        `[Preflight] Credit balance lookup failed for ${userId}: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
      return {
        id: 'credits',
        label: 'Your credits',
        status: 'degraded',
        blocking: false,
        reason: 'unreachable',
        detail: 'Could not read credit balance',
      };
    }
  }

  /**
   * Map an HTTP failure onto the reason the user actually needs to hear.
   * 402/429 are the "busy or out of budget" cases the build must not start
   * into; 401/403 mean an operator has to rotate a key.
   */
  private classifyHttpFailure(
    e: unknown,
    status?: number,
  ): { status: 'down'; reason: PreflightReason; detail: string } {
    const detail = isAxiosError(e)
      ? `HTTP ${status ?? 'ERR'}: ${String(e.code ?? e.message).slice(0, 200)}`
      : e instanceof Error
        ? e.message.slice(0, 200)
        : 'request failed';

    let reason: PreflightReason = 'unreachable';
    if (status === 401 || status === 403) reason = 'unauthorized';
    else if (status === 402) reason = 'budget_exhausted';
    else if (status === 429) reason = 'quota_exhausted';

    return { status: 'down', reason, detail };
  }
}
