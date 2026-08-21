/**
 * Mirrors `anthropic-sampling-params.spec.ts`. The failure being pinned here
 * is a live one: the admin key probe sent `max_tokens` to a GPT-5 model and
 * got `400 unsupported_parameter: use 'max_completion_tokens' instead`. The
 * same body is sent by real traffic, so any GPT-5 route would have failed
 * identically.
 */
import {
  openaiCompletionParams,
  openaiUsesCompletionTokens,
} from './openai-params';

describe('openaiCompletionParams', () => {
  it('uses max_completion_tokens and no temperature on GPT-5', () => {
    expect(openaiCompletionParams('gpt-5-mini', 1, 0.5)).toEqual({
      max_completion_tokens: 1,
    });
  });

  it('does the same for the o-series', () => {
    expect(openaiCompletionParams('o3-mini', 64, 0.2)).toEqual({
      max_completion_tokens: 64,
    });
  });

  it('keeps the legacy pair on GPT-4 era models', () => {
    expect(openaiCompletionParams('gpt-4o-mini', 32, 0.7)).toEqual({
      max_tokens: 32,
      temperature: 0.7,
    });
  });

  it('omits temperature when the caller did not set one', () => {
    expect(openaiCompletionParams('gpt-4o', 8, undefined)).toEqual({
      max_tokens: 8,
    });
  });

  it('covers future families so a new release does not reintroduce the 400', () => {
    expect(openaiUsesCompletionTokens('gpt-6')).toBe(true);
    expect(openaiUsesCompletionTokens('o5-pro')).toBe(true);
  });

  it('does not misfire on unrelated ids', () => {
    expect(openaiUsesCompletionTokens('gpt-4.1')).toBe(false);
    expect(openaiUsesCompletionTokens('chatgpt-4o-latest')).toBe(false);
  });
});
