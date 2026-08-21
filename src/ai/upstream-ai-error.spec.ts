import { HttpStatus } from '@nestjs/common';
import {
  mapModelScopedProviderError,
  mapProviderCapacityError,
} from './upstream-ai-error';

/**
 * Pins the live /ai/validate 500: OpenAI 404 "gpt-5-codex has been
 * deprecated" must become a tagged 502, not an untyped 500.
 */
describe('mapModelScopedProviderError', () => {
  const gpt5Codex =
    '404 The model `gpt-5-codex` has been deprecated, learn more here: https://platform.openai.com/docs/deprecations';

  it('maps the live gpt-5-codex 404 to provider_model_unavailable', () => {
    const ex = mapModelScopedProviderError(404, gpt5Codex, 'gpt-5-codex');
    expect(ex).not.toBeNull();
    expect(ex!.getStatus()).toBe(HttpStatus.BAD_GATEWAY);
    expect(ex!.getResponse()).toEqual(
      expect.objectContaining({
        reason: 'provider_model_unavailable',
        model: 'gpt-5-codex',
      }),
    );
  });

  it('maps a deprecation message with no HTTP status', () => {
    const ex = mapModelScopedProviderError(
      undefined,
      'The model `gpt-5-codex` has been deprecated',
      'gpt-5-codex',
    );
    expect(ex?.getStatus()).toBe(HttpStatus.BAD_GATEWAY);
  });

  it('leaves genuine upstream 500s unmapped so they stay bugs', () => {
    expect(mapModelScopedProviderError(500, 'upstream boom', 'gpt-4o')).toBeNull();
  });

  it('leaves auth failures to the credential mapper', () => {
    expect(
      mapModelScopedProviderError(401, 'invalid api key', 'gpt-4o'),
    ).toBeNull();
  });
});

describe('mapProviderCapacityError', () => {
  const gemini503 =
    '[GoogleGenerativeAI Error]: Error fetching from https://generativelanguage.googleapis.com/v1beta/models/gemini-3.7-flash:generateContent: [503 Service Unavailable] This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.';

  it('maps Gemini high-demand 503 to a tagged 429, not a 503', () => {
    const ex = mapProviderCapacityError(503, gemini503);
    expect(ex).not.toBeNull();
    expect(ex!.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
    expect(ex!.getResponse()).toEqual(
      expect.objectContaining({ reason: 'provider_rate_limited' }),
    );
  });

  it('maps the high-demand wording even without a numeric status', () => {
    const ex = mapProviderCapacityError(undefined, gemini503);
    expect(ex?.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
  });
});
