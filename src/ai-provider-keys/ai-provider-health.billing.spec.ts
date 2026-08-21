/**
 * Regression guard for the "green key that cannot serve" failure.
 *
 * Anthropic reports an exhausted account balance as a 400
 * invalid_request_error, not a 402. `isKeyFault` only recognised
 * 401/403/429/402, so the key stayed `healthy` in Mongo while every request
 * through it failed — and the build preflight, which reads that row, waved
 * users straight into anonymous 500s from /ai/validate.
 *
 * The opposite mistake is worse and is also pinned here: a blanket
 * `status === 400` would demote perfectly good keys on ordinary
 * malformed-request errors, which is how a bad model id once took the whole
 * platform out of routing.
 */
import { AiProviderHealthService } from './ai-provider-health.service';

describe('AiProviderHealthService — billing failures', () => {
  const service = new AiProviderHealthService(
    // Only the pure classifiers are exercised here; no Mongo needed.
    null as never,
    null as never,
  );

  const ANTHROPIC_NO_BALANCE =
    '400 {"type":"error","error":{"type":"invalid_request_error","message":' +
    '"Your credit balance is too low to access the Anthropic API. Please go ' +
    'to Plans & Billing to upgrade or purchase credits."}}';

  it('treats a 400 that says the balance is too low as a key fault', () => {
    expect(service.isKeyFault(400, ANTHROPIC_NO_BALANCE)).toBe(true);
  });

  it('classifies that key as quota_exceeded, so routing drops it', () => {
    expect(service.classifyHttpStatus(400)).toBe('quota_exceeded');
  });

  it('still refuses to condemn a key on an ordinary 400', () => {
    expect(
      service.isKeyFault(
        400,
        '400 {"error":{"message":"temperature: unsupported parameter"}}',
      ),
    ).toBe(false);
  });

  it('still refuses to condemn a key on a model-scoped 404', () => {
    expect(
      service.isKeyFault(404, 'not_found_error: model does not exist'),
    ).toBe(false);
  });

  it('keeps recognising the classic credential faults', () => {
    expect(service.isKeyFault(401, 'unauthorized')).toBe(true);
    expect(service.isKeyFault(429, 'rate limit')).toBe(true);
    expect(service.isKeyFault(402, 'payment required')).toBe(true);
  });
});
