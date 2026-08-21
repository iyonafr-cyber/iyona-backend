import {
  anthropicAcceptsSamplingParams,
  anthropicSamplingParams,
} from './llm.service';
import { MODEL_CATALOG_SEED } from '../models/model-catalog.seed';

/**
 * Regression guard for a production 500 on the builder chat.
 *
 * Anthropic removed `temperature` / `top_p` / `top_k` on Claude Opus 4.7 and
 * later. `chatAnthropic` and `streamAnthropic` passed `temperature` through
 * unconditionally, so once routing fell through to the `claude-opus-4-7`
 * catalog row every `/ai/validate` call came back
 * `400 invalid_request_error: "temperature is deprecated for this model."`
 * and surfaced to users as "Internal server error".
 *
 * The rule is matched on the version prefix rather than an id allowlist so a
 * future Opus row pulled in by `POST /admin/models/refresh` can't quietly
 * reintroduce the same failure.
 */
describe('anthropicAcceptsSamplingParams', () => {
  it('rejects sampling params for Opus 4.7 and later', () => {
    expect(anthropicAcceptsSamplingParams('claude-opus-4-7')).toBe(false);
    expect(anthropicAcceptsSamplingParams('claude-opus-4-8')).toBe(false);
    expect(anthropicAcceptsSamplingParams('claude-opus-4-12')).toBe(false);
    expect(anthropicAcceptsSamplingParams('claude-opus-5-0')).toBe(false);
  });

  it('handles the dated form of an Opus id', () => {
    // Catalog rows refreshed from GET /v1/models arrive dated.
    expect(anthropicAcceptsSamplingParams('claude-opus-4-7-20260416')).toBe(
      false,
    );
    expect(anthropicAcceptsSamplingParams('claude-opus-4-5-20251101')).toBe(
      true,
    );
  });

  it('still allows sampling params on older Opus rows', () => {
    expect(anthropicAcceptsSamplingParams('claude-opus-4-6')).toBe(true);
    expect(anthropicAcceptsSamplingParams('claude-opus-4-1')).toBe(true);
  });

  it('only restricts Opus — Sonnet and Haiku are unaffected', () => {
    expect(anthropicAcceptsSamplingParams('claude-sonnet-4-6')).toBe(true);
    expect(anthropicAcceptsSamplingParams('claude-sonnet-4-9')).toBe(true);
    expect(anthropicAcceptsSamplingParams('claude-haiku-4-7')).toBe(true);
  });

  it('defaults to permitting params for ids it cannot parse', () => {
    // Never block a request on a naming scheme we do not recognise.
    expect(anthropicAcceptsSamplingParams('some-future-model')).toBe(true);
  });

  it('classifies every seeded Anthropic row', () => {
    const anthropicSeeds = MODEL_CATALOG_SEED.filter(
      (m) => m.provider === 'anthropic',
    );
    expect(anthropicSeeds.length).toBeGreaterThan(0);
    for (const seed of anthropicSeeds) {
      const expected = !/^claude-opus-4-(7|8|9)/.test(seed.modelId);
      expect(anthropicAcceptsSamplingParams(seed.modelId)).toBe(expected);
    }
  });
});

describe('anthropicSamplingParams', () => {
  it('omits temperature entirely for a model that rejects it', () => {
    expect(anthropicSamplingParams('claude-opus-4-7', 0.5)).toEqual({});
    // Absent, not undefined: a present `temperature: undefined` key would
    // still be a key, and the SDK is what decides how to serialise it.
    expect(
      'temperature' in anthropicSamplingParams('claude-opus-4-7', 0.5),
    ).toBe(false);
  });

  it('passes temperature through for a model that accepts it', () => {
    expect(anthropicSamplingParams('claude-sonnet-4-6', 0.5)).toEqual({
      temperature: 0.5,
    });
  });

  it('preserves an explicit temperature of 0', () => {
    // database-detect.service.ts asks for 0; a truthiness check would drop it.
    expect(anthropicSamplingParams('claude-sonnet-4-6', 0)).toEqual({
      temperature: 0,
    });
  });

  it('omits temperature when the caller did not set one', () => {
    expect(anthropicSamplingParams('claude-sonnet-4-6', undefined)).toEqual({});
  });
});
