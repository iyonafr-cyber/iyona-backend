import { ProviderCatalogService } from './provider-catalog.service';
import type { AiProviderRouterService } from '../ai-provider-keys/ai-provider-router.service';
import { GOOGLE_MODEL_ALIASES } from '../credits/llm.service';

/**
 * The admin "Refresh from providers" button is the only path that gets real
 * API ids into the catalog, so its filters decide which models are reachable
 * at all. They used to pin generation numbers, which made every new release
 * invisible until someone edited the regex — `claude-opus-5` and
 * `claude-opus-4-8` were both being dropped on the floor.
 *
 * Fixture ids below are the real response of
 * `GET https://api.anthropic.com/v1/models`.
 */
describe('ProviderCatalogService coding patterns', () => {
  const service = new ProviderCatalogService(
    {} as unknown as AiProviderRouterService,
  );
  const patterns = (
    service as unknown as { codingPatterns: Record<string, RegExp> }
  ).codingPatterns;

  const anthropicLive = [
    'claude-opus-5',
    'claude-sonnet-5',
    'claude-opus-4-8',
    'claude-opus-4-7',
    'claude-sonnet-4-6',
    'claude-opus-4-6',
    'claude-opus-4-5-20251101',
    'claude-haiku-4-5-20251001',
    'claude-sonnet-4-5-20250929',
  ];

  it('keeps every current Anthropic coding model, including gen 5', () => {
    for (const id of anthropicLive) {
      expect(patterns.anthropic.test(id)).toBe(true);
    }
  });

  it('does not pin a generation number for any provider', () => {
    // A digit range like [34] or an alternation like (2|3) is the exact bug:
    // it silently drops the next release.
    for (const re of Object.values(patterns)) {
      expect(re.source).not.toMatch(/\[\d-?\d\]/);
      expect(re.source).not.toMatch(/\(\d\|\d\)/);
    }
  });

  it('survives a hypothetical next generation', () => {
    expect(patterns.anthropic.test('claude-opus-6')).toBe(true);
    expect(patterns.openai.test('gpt-6-turbo')).toBe(true);
    expect(patterns.google.test('gemini-4-pro')).toBe(true);
  });

  it('still rejects non-coding noise', () => {
    expect(patterns.openai.test('text-embedding-3-large')).toBe(false);
    expect(patterns.openai.test('dall-e-3')).toBe(false);
    expect(patterns.openai.test('whisper-1')).toBe(false);
    expect(patterns.google.test('text-bison-001')).toBe(false);
  });
});

describe('GOOGLE_MODEL_ALIASES', () => {
  it('only rewrites the synthetic seed id', () => {
    expect(Object.keys(GOOGLE_MODEL_ALIASES)).toEqual(['gemini-3-1-high']);
  });

  it('leaves a real fetched id untouched', () => {
    // The old blanket `-N-N` → `-N.N` regex mangled dated preview ids like
    // this one into something the API rejects.
    const fetched = 'gemini-2.0-flash-thinking-exp-01-21';
    expect(GOOGLE_MODEL_ALIASES[fetched]).toBeUndefined();
    expect(fetched.replace(/-(\d+)-(\d+)/g, '-$1.$2')).not.toBe(fetched);
  });
});
