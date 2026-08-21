import { OPENAI_MODEL_ALIASES } from './llm.service';
import { MODEL_PRICES } from './pricing.service';

/**
 * Regression guard for a production 500 on POST /ai/validate.
 *
 * OpenAI shut `gpt-5-codex` down on 2026-07-23. Catalog / task routes still
 * pointed at that id, so chat.completions returned
 * `404 The model has been deprecated`, which `meteredChat` rethrew as a
 * bare Error and the global filter rendered as Internal server error.
 */
describe('OPENAI_MODEL_ALIASES', () => {
  it('maps the retired gpt-5-codex catalog id onto a live chat model', () => {
    expect(OPENAI_MODEL_ALIASES['gpt-5-codex']).toBe('gpt-4o');
  });

  it('only aliases ids that exist in the pricing table', () => {
    for (const from of Object.keys(OPENAI_MODEL_ALIASES)) {
      expect(MODEL_PRICES[from]).toBeDefined();
      expect(MODEL_PRICES[from].provider).toBe('openai');
    }
  });

  it('aliases onto an id that is also in the pricing table', () => {
    for (const to of Object.values(OPENAI_MODEL_ALIASES)) {
      expect(MODEL_PRICES[to]).toBeDefined();
      expect(MODEL_PRICES[to].provider).toBe('openai');
    }
  });
});
