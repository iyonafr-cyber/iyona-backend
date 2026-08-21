import { ANTHROPIC_MODEL_ALIASES } from './llm.service';
import { MODEL_PRICES } from './pricing.service';

/**
 * Regression guard for a production 500.
 *
 * The alias map used to point the 4.5 catalog rows at
 * `claude-{sonnet,opus}-4-20250514` — Claude *4*, not 4.5 — ids Anthropic
 * has since retired. Every call routed to a 4.5 row got a 404
 * `not_found_error` from the provider, which surfaced to users as
 * "Internal server error". It stayed hidden while OpenAI was healthy,
 * because nothing reached the Anthropic branch; the moment the OpenAI key
 * went unhealthy, `/ai/validate` started failing for everyone.
 *
 * Verified against `GET https://api.anthropic.com/v1/models`.
 */
describe('ANTHROPIC_MODEL_ALIASES', () => {
  it('maps 4.5 catalog ids to their real dated API ids', () => {
    expect(ANTHROPIC_MODEL_ALIASES['claude-sonnet-4-5']).toBe(
      'claude-sonnet-4-5-20250929',
    );
    expect(ANTHROPIC_MODEL_ALIASES['claude-opus-4-5']).toBe(
      'claude-opus-4-5-20251101',
    );
  });

  it('never maps a 4.5 id onto a bare Claude 4 id', () => {
    // The exact shape of the old bug: `-4-<date>` where the source id
    // claimed 4.5. Anything matching this is a retired model.
    for (const [from, to] of Object.entries(ANTHROPIC_MODEL_ALIASES)) {
      if (!from.includes('-4-5')) continue;
      expect(to).not.toMatch(/-4-\d{8}$/);
    }
  });

  it('only aliases ids that actually exist in the pricing table', () => {
    for (const from of Object.keys(ANTHROPIC_MODEL_ALIASES)) {
      expect(MODEL_PRICES[from]).toBeDefined();
      expect(MODEL_PRICES[from].provider).toBe('anthropic');
    }
  });

  it('leaves modern catalog ids unaliased — they are already valid API ids', () => {
    // claude-opus-4-7 / claude-sonnet-4-6 are returned verbatim by
    // GET /v1/models, so an alias entry for them would be a bug.
    expect(ANTHROPIC_MODEL_ALIASES['claude-opus-4-7']).toBeUndefined();
    expect(ANTHROPIC_MODEL_ALIASES['claude-sonnet-4-6']).toBeUndefined();
  });
});
