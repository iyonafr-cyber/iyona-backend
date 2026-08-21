import { BadRequestException } from '@nestjs/common';
import { ModelRouterService } from './model-router.service';
import type { AiProviderRouterService } from '../ai-provider-keys/ai-provider-router.service';
import type {
  ModelCatalogService,
  ModelSnapshot,
} from '../models/models.service';
import type {
  TaskRouteService,
  TaskRouteSnapshot,
} from '../models/task-routes.service';
import type { RouterTaskName } from '../models/entities/ai-task-route.entity';

/**
 * Build a thin stub of `ModelCatalogService` that satisfies the bits
 * `ModelRouterService` actually touches (`get`, `getDefault`).
 */
function buildCatalog(
  rows: ModelSnapshot[],
  defaultId: string | null,
): ModelCatalogService {
  const byId = new Map(rows.map((r) => [r.modelId, r]));
  const fakeDefault = defaultId ? (byId.get(defaultId) ?? null) : null;
  return {
    get: (id: string) => byId.get(id) ?? null,
    getDefault: () => fakeDefault,
  } as unknown as ModelCatalogService;
}

function buildProviderRouter(
  availability: Record<'openai' | 'anthropic' | 'google', boolean>,
): AiProviderRouterService {
  return {
    getLastAvailabilitySync: () => ({ ...availability }),
  } as unknown as AiProviderRouterService;
}

/**
 * Stub of `TaskRouteService`. `routes` maps a task to its admin config;
 * anything absent behaves as an unconfigured (inert) row.
 */
function buildTaskRoutes(
  routes: Partial<Record<RouterTaskName, Partial<TaskRouteSnapshot>>> = {},
): TaskRouteService {
  const resolve = (task: RouterTaskName): TaskRouteSnapshot => ({
    task,
    primaryModelId: null,
    fallbackModelIds: [],
    enforce: false,
    enabled: true,
    ...(routes[task] ?? {}),
  });
  return {
    get: (task: RouterTaskName) => resolve(task),
    candidates: (task: RouterTaskName) => {
      const row = resolve(task);
      if (!row.enabled || !row.primaryModelId) return [];
      return [row.primaryModelId, ...row.fallbackModelIds];
    },
  } as unknown as TaskRouteService;
}

function model(
  id: string,
  provider: 'openai' | 'anthropic' | 'google',
  overrides: Partial<ModelSnapshot> = {},
): ModelSnapshot {
  return {
    modelId: id,
    provider,
    displayName: id,
    tier: 'medium',
    category: 'coding',
    enabled: true,
    isDefault: false,
    order: 0,
    inputPerMillion: 1,
    outputPerMillion: 1,
    maxOutputTokens: 4000,
    contextTokens: 128000,
    codingOptimized: true,
    ...overrides,
  };
}

/**
 * Covers the precedence chain added for the user/admin model-picker
 * feature: request override > project default > global default >
 * task-based fallback.
 */
describe('ModelRouterService.pickModel precedence', () => {
  const allOn = { openai: true, anthropic: true, google: true };

  it('honors per-request modelId above all else', () => {
    const catalog = buildCatalog(
      [
        model('claude-opus-4-7', 'anthropic'),
        model('gemini-3-1-high', 'google', { isDefault: true }),
      ],
      'gemini-3-1-high',
    );
    const router = new ModelRouterService(
      catalog,
      buildProviderRouter(allOn),
      buildTaskRoutes(),
    );
    const route = router.pickModel(
      'reason',
      {},
      { modelId: 'claude-opus-4-7' },
    );
    expect(route.model).toBe('claude-opus-4-7');
    expect(route.provider).toBe('anthropic');
  });

  it('falls through to project default when no request pick', () => {
    const catalog = buildCatalog(
      [
        model('claude-sonnet-4-6', 'anthropic'),
        model('gemini-3-1-high', 'google', { isDefault: true }),
      ],
      'gemini-3-1-high',
    );
    const router = new ModelRouterService(
      catalog,
      buildProviderRouter(allOn),
      buildTaskRoutes(),
    );
    const route = router.pickModel(
      'reason',
      {},
      { projectDefaultModelId: 'claude-sonnet-4-6' },
    );
    expect(route.model).toBe('claude-sonnet-4-6');
  });

  it('uses global default when no override is provided', () => {
    const catalog = buildCatalog(
      [model('gemini-3-1-high', 'google', { isDefault: true })],
      'gemini-3-1-high',
    );
    const router = new ModelRouterService(
      catalog,
      buildProviderRouter(allOn),
      buildTaskRoutes(),
    );
    const route = router.pickModel('reason', {}, {});
    expect(route.model).toBe('gemini-3-1-high');
    expect(route.provider).toBe('google');
  });

  it('falls through to task-based routes when catalog has no default', () => {
    const catalog = buildCatalog([], null);
    const router = new ModelRouterService(
      catalog,
      buildProviderRouter(allOn),
      buildTaskRoutes(),
    );
    const route = router.pickModel('reason', {}, {});
    expect(['claude-sonnet-4-5', 'gpt-4o']).toContain(route.model);
  });

  it('throws 400 when an explicitly-picked model is disabled', () => {
    const catalog = buildCatalog(
      [
        model('claude-opus-4-7', 'anthropic', { enabled: false }),
        model('gemini-3-1-high', 'google', { isDefault: true }),
      ],
      'gemini-3-1-high',
    );
    const router = new ModelRouterService(
      catalog,
      buildProviderRouter(allOn),
      buildTaskRoutes(),
    );
    expect(() =>
      router.pickModel('reason', {}, { modelId: 'claude-opus-4-7' }),
    ).toThrow(BadRequestException);
  });

  it('silently skips a disabled project default and falls to global', () => {
    const catalog = buildCatalog(
      [
        model('claude-opus-4-7', 'anthropic', { enabled: false }),
        model('gemini-3-1-high', 'google', { isDefault: true }),
      ],
      'gemini-3-1-high',
    );
    const router = new ModelRouterService(
      catalog,
      buildProviderRouter(allOn),
      buildTaskRoutes(),
    );
    const route = router.pickModel(
      'reason',
      {},
      { projectDefaultModelId: 'claude-opus-4-7' },
    );
    expect(route.model).toBe('gemini-3-1-high');
  });

  it("treats 'auto' as no-override", () => {
    const catalog = buildCatalog(
      [model('gemini-3-1-high', 'google', { isDefault: true })],
      'gemini-3-1-high',
    );
    const router = new ModelRouterService(
      catalog,
      buildProviderRouter(allOn),
      buildTaskRoutes(),
    );
    const route = router.pickModel('reason', {}, { modelId: 'auto' });
    expect(route.model).toBe('gemini-3-1-high');
  });
});

/**
 * Admin-configured per-task routing: primary + ordered fallback chain,
 * and the `enforce` flag that lifts it above the user's own pick.
 */
describe('ModelRouterService per-task admin routes', () => {
  const allOn = { openai: true, anthropic: true, google: true };

  const catalog = () =>
    buildCatalog(
      [
        model('claude-opus-4-7', 'anthropic'),
        model('claude-sonnet-4-6', 'anthropic'),
        model('gpt-5-codex', 'openai'),
        model('gemini-3-1-high', 'google', { isDefault: true }),
        model('retired-model', 'openai', { enabled: false }),
      ],
      'gemini-3-1-high',
    );

  it('uses the task primary over the global default', () => {
    const router = new ModelRouterService(
      catalog(),
      buildProviderRouter(allOn),
      buildTaskRoutes({ plan: { primaryModelId: 'claude-opus-4-7' } }),
    );
    const route = router.pickModel('plan', {}, {});
    expect(route.model).toBe('claude-opus-4-7');
    expect(route.source).toBe('taskRoutePrimary');
    expect(route.fellBack).toBe(false);
  });

  it('leaves other tasks on the global default', () => {
    const router = new ModelRouterService(
      catalog(),
      buildProviderRouter(allOn),
      buildTaskRoutes({ plan: { primaryModelId: 'claude-opus-4-7' } }),
    );
    expect(router.pickModel('reason', {}, {}).model).toBe('gemini-3-1-high');
  });

  it('walks to the next fallback when the primary provider is down', () => {
    const router = new ModelRouterService(
      catalog(),
      buildProviderRouter({ ...allOn, anthropic: false }),
      buildTaskRoutes({
        plan: {
          primaryModelId: 'claude-opus-4-7',
          fallbackModelIds: ['gpt-5-codex'],
        },
      }),
    );
    const route = router.pickModel('plan', {}, {});
    expect(route.model).toBe('gpt-5-codex');
    expect(route.source).toBe('taskRouteFallback');
    expect(route.fellBack).toBe(true);
  });

  it('skips a disabled model in the chain', () => {
    const router = new ModelRouterService(
      catalog(),
      buildProviderRouter(allOn),
      buildTaskRoutes({
        plan: {
          primaryModelId: 'retired-model',
          fallbackModelIds: ['claude-sonnet-4-6'],
        },
      }),
    );
    expect(router.pickModel('plan', {}, {}).model).toBe('claude-sonnet-4-6');
  });

  it('falls through to the global default when the whole chain is dead', () => {
    const router = new ModelRouterService(
      catalog(),
      buildProviderRouter({ openai: false, anthropic: false, google: true }),
      buildTaskRoutes({
        plan: {
          primaryModelId: 'claude-opus-4-7',
          fallbackModelIds: ['gpt-5-codex'],
        },
      }),
    );
    const route = router.pickModel('plan', {}, {});
    expect(route.model).toBe('gemini-3-1-high');
    expect(route.source).toBe('globalDefault');
  });

  it('yields to a per-request pick when enforce is off', () => {
    const router = new ModelRouterService(
      catalog(),
      buildProviderRouter(allOn),
      buildTaskRoutes({
        plan: { primaryModelId: 'claude-opus-4-7', enforce: false },
      }),
    );
    const route = router.pickModel('plan', {}, { modelId: 'gpt-5-codex' });
    expect(route.model).toBe('gpt-5-codex');
  });

  it('overrides a per-request pick when enforce is on', () => {
    const router = new ModelRouterService(
      catalog(),
      buildProviderRouter(allOn),
      buildTaskRoutes({
        plan: { primaryModelId: 'claude-opus-4-7', enforce: true },
      }),
    );
    const route = router.pickModel('plan', {}, { modelId: 'gpt-5-codex' });
    expect(route.model).toBe('claude-opus-4-7');
  });

  it('overrides a project default when enforce is on', () => {
    const router = new ModelRouterService(
      catalog(),
      buildProviderRouter(allOn),
      buildTaskRoutes({
        plan: { primaryModelId: 'claude-opus-4-7', enforce: true },
      }),
    );
    const route = router.pickModel(
      'plan',
      {},
      { projectDefaultModelId: 'gpt-5-codex' },
    );
    expect(route.model).toBe('claude-opus-4-7');
  });

  it('ignores a disabled route row entirely', () => {
    const router = new ModelRouterService(
      catalog(),
      buildProviderRouter(allOn),
      buildTaskRoutes({
        plan: {
          primaryModelId: 'claude-opus-4-7',
          enforce: true,
          enabled: false,
        },
      }),
    );
    expect(router.pickModel('plan', {}, {}).model).toBe('gemini-3-1-high');
  });

  it('skips a provider-retired catalog id and walks the fallback', () => {
    const retired = buildCatalog(
      [
        model('gpt-5-codex', 'openai', {
          deprecatedAt: new Date('2026-07-23'),
        }),
        model('gpt-4o', 'openai'),
        model('gemini-3-1-high', 'google', { isDefault: true }),
      ],
      'gemini-3-1-high',
    );
    const router = new ModelRouterService(
      retired,
      buildProviderRouter(allOn),
      buildTaskRoutes({
        plan: {
          primaryModelId: 'gpt-5-codex',
          fallbackModelIds: ['gpt-4o'],
        },
      }),
    );
    const route = router.pickModel('plan', {}, {});
    expect(route.model).toBe('gpt-4o');
    expect(route.source).toBe('taskRouteFallback');
  });

  it('rejects an explicit pick of a retired model as a config error', () => {
    const retired = buildCatalog(
      [
        model('gpt-5-codex', 'openai', {
          deprecatedAt: new Date('2026-07-23'),
        }),
        model('gemini-3-1-high', 'google', { isDefault: true }),
      ],
      'gemini-3-1-high',
    );
    const router = new ModelRouterService(
      retired,
      buildProviderRouter(allOn),
      buildTaskRoutes(),
    );
    expect(() =>
      router.pickModel('classify', {}, { modelId: 'gpt-5-codex' }),
    ).toThrow(BadRequestException);
  });
});
