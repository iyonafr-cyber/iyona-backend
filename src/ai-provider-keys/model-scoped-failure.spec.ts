import { AiProviderHealthService } from './ai-provider-health.service';

/**
 * Regression guard for the outage cascade.
 *
 * A retired Anthropic model alias returned 404 `not_found_error`. That is a
 * statement about the *model id*, but `classifyHttpStatus` fell through its
 * default and marked the *key* `rate_limited`. Unhealthy keys are excluded
 * from routing and only `recordSuccess` restores them — which can't happen
 * while excluded — so each provider that got touched dropped out permanently.
 * With all three gone the router threw "No AI provider configured" and every
 * request 500'd.
 *
 * One bad catalog id must never be able to do that again.
 */
describe('AiProviderHealthService.isModelScopedFailure', () => {
  const svc = Object.create(
    AiProviderHealthService.prototype,
  ) as AiProviderHealthService;

  it('treats a 404 as model-scoped, not a key problem', () => {
    expect(svc.isModelScopedFailure(404, 'whatever')).toBe(true);
  });

  it('recognises provider not-found payloads without a status', () => {
    expect(
      svc.isModelScopedFailure(undefined, 'model: claude-sonnet-4-20250514'),
    ).toBe(true);
    expect(
      svc.isModelScopedFailure(undefined, '{"type":"not_found_error"}'),
    ).toBe(true);
    expect(svc.isModelScopedFailure(undefined, 'model_not_found')).toBe(true);
    expect(
      svc.isModelScopedFailure(undefined, 'The model `x` does not exist'),
    ).toBe(true);
  });

  it('treats OpenAI deprecation 404s as model-scoped', () => {
    expect(
      svc.isModelScopedFailure(
        404,
        'The model `gpt-5-codex` has been deprecated, learn more here: https://platform.openai.com/docs/deprecations',
      ),
    ).toBe(true);
    expect(
      svc.isModelScopedFailure(
        undefined,
        'The model `gpt-5-codex` has been deprecated',
      ),
    ).toBe(true);
  });

  it('treats Gemini TTS modality 400s as model-scoped', () => {
    expect(
      svc.isModelScopedFailure(
        400,
        'The requested combination of response modalities (TEXT) is not supported by the model. models/gemini-2.5-flash-preview-tts accepts the following combination of response modalities:\n* AUDIO\n',
      ),
    ).toBe(true);
  });

  it('still treats real key problems as key problems', () => {
    expect(svc.isModelScopedFailure(401, 'invalid x-api-key')).toBe(false);
    expect(svc.isModelScopedFailure(429, 'rate limit exceeded')).toBe(false);
    expect(svc.isModelScopedFailure(402, 'insufficient_quota')).toBe(false);
    expect(svc.isModelScopedFailure(500, 'upstream boom')).toBe(false);
  });

  it('leaves auth and quota classification untouched', () => {
    expect(svc.classifyHttpStatus(401)).toBe('invalid');
    expect(svc.classifyHttpStatus(403)).toBe('invalid');
    expect(svc.classifyHttpStatus(429)).toBe('rate_limited');
    expect(svc.classifyHttpStatus(402)).toBe('quota_exceeded');
  });
});

/**
 * `isKeyFault` is the gate `recordFailure` actually uses. Each "must not
 * demote" case below is a real `lastFailureReason` read off the three keys
 * on this deployment — every one of them had knocked a working key out of
 * routing.
 */
describe('AiProviderHealthService.isKeyFault', () => {
  const svc = Object.create(
    AiProviderHealthService.prototype,
  ) as AiProviderHealthService;

  it('demotes on genuine credential signals', () => {
    expect(svc.isKeyFault(401, 'invalid x-api-key')).toBe(true);
    expect(svc.isKeyFault(403, 'forbidden')).toBe(true);
    expect(svc.isKeyFault(429, 'slow down')).toBe(true);
    expect(svc.isKeyFault(402, 'payment required')).toBe(true);
    expect(svc.isKeyFault(undefined, 'insufficient_quota')).toBe(true);
    expect(svc.isKeyFault(undefined, 'Rate limit reached')).toBe(true);
  });

  it('does not demote on a retired model id', () => {
    expect(svc.isKeyFault(404, 'model: claude-sonnet-4-20250514')).toBe(false);
  });

  it('does not demote when a non-chat model is routed to chat/completions', () => {
    expect(
      svc.isKeyFault(
        404,
        'This is not a chat model and thus not supported in the v1/chat/completions endpoint.',
      ),
    ).toBe(false);
  });

  it('does not demote on the SDK client-side streaming guard', () => {
    // Thrown before any HTTP request, so no status — this one took the
    // Anthropic key out even though the key was fine.
    expect(
      svc.isKeyFault(
        undefined,
        'Streaming is required for operations that may take longer than 10 minutes.',
      ),
    ).toBe(false);
  });

  it('does not demote on provider-side or transport failures', () => {
    expect(svc.isKeyFault(500, 'internal server error')).toBe(false);
    expect(svc.isKeyFault(503, 'overloaded_error')).toBe(false);
    expect(svc.isKeyFault(undefined, 'socket hang up')).toBe(false);
  });
});
