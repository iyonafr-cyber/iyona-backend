import { planDeprecations, DeprecationCandidate } from './deprecation';
import { RETIRED_MODEL_IDS } from './model-catalog.seed';

/**
 * Refresh writes to the catalog now, and a wrong write here takes a model out
 * of routing for every user. The cases below are the ones that make that
 * dangerous: a provider that didn't answer, and a provider that answered with
 * fewer models than we have rows for.
 */
describe('planDeprecations', () => {
  const row = (
    over: Partial<DeprecationCandidate> & { modelId: string },
  ): DeprecationCandidate => ({
    provider: 'anthropic',
    enabled: true,
    deprecatedAt: null,
    ...over,
  });

  it('deprecates an enabled row its provider stopped listing', () => {
    const plan = planDeprecations({
      rows: [row({ modelId: 'claude-sonnet-4-5' })],
      seenModelIds: ['claude-sonnet-4-6'],
      respondedProviders: ['anthropic'],
    });

    expect(plan.deprecate).toEqual(['claude-sonnet-4-5']);
    expect(plan.stale).toEqual(['claude-sonnet-4-5']);
  });

  it('leaves every row alone when the provider never answered', () => {
    const plan = planDeprecations({
      rows: [
        row({ modelId: 'claude-opus-4-7' }),
        row({ modelId: 'gpt-4o', provider: 'openai' }),
      ],
      // OpenAI timed out: zero models back, and it is absent from the
      // responding list. Its rows must survive untouched.
      seenModelIds: ['claude-opus-4-7'],
      respondedProviders: ['anthropic'],
    });

    expect(plan.deprecate).toEqual([]);
    expect(plan.stale).toEqual([]);
  });

  it('does not re-stamp a row that is already deprecated', () => {
    const plan = planDeprecations({
      rows: [
        row({
          modelId: 'claude-opus-4-1',
          deprecatedAt: new Date('2026-01-01'),
        }),
      ],
      seenModelIds: [],
      respondedProviders: ['anthropic'],
    });

    expect(plan.deprecate).toEqual([]);
  });

  it('still reports an already-deprecated row as stale while it stays enabled', () => {
    const plan = planDeprecations({
      rows: [
        row({
          modelId: 'claude-opus-4-1',
          enabled: true,
          deprecatedAt: new Date('2026-01-01'),
        }),
      ],
      seenModelIds: [],
      respondedProviders: ['anthropic'],
    });

    expect(plan.stale).toEqual(['claude-opus-4-1']);
  });

  it('restores a row the provider lists again', () => {
    const plan = planDeprecations({
      rows: [
        row({
          modelId: 'claude-opus-4-6',
          deprecatedAt: new Date('2026-02-02'),
        }),
      ],
      seenModelIds: ['claude-opus-4-6'],
      respondedProviders: ['anthropic'],
    });

    expect(plan.restore).toEqual(['claude-opus-4-6']);
  });

  it('never restores an id we retired ourselves', () => {
    // Otherwise refresh and `seed()` flip the row on every boot: OpenAI still
    // lists `gpt-5-codex`, we retired it because calling it 404s.
    const retired = RETIRED_MODEL_IDS[0];
    const plan = planDeprecations({
      rows: [
        row({
          modelId: retired,
          provider: 'openai',
          enabled: false,
          deprecatedAt: new Date('2026-07-23'),
        }),
      ],
      seenModelIds: [retired],
      respondedProviders: ['openai'],
    });

    expect(plan.restore).toEqual([]);
  });

  it('ignores disabled rows when reporting what needs a human', () => {
    const plan = planDeprecations({
      rows: [
        row({ modelId: 'gpt-4-0613', provider: 'openai', enabled: false }),
      ],
      seenModelIds: [],
      respondedProviders: ['openai'],
    });

    expect(plan.deprecate).toEqual(['gpt-4-0613']);
    expect(plan.stale).toEqual([]);
  });
});
