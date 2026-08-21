import { HttpException, HttpStatus } from '@nestjs/common';
import { isModelScopedProviderFailure } from '../ai-provider-keys/ai-provider-health.service';

/**
 * Google (and others) report capacity as 503 "high demand" / overloaded.
 * We must not forward HTTP 503 to the SPA — that raises the site-wide
 * maintenance banner. 429 + `provider_rate_limited` is the existing
 * "busy, try again" path.
 */
export function isProviderCapacityFailure(
  status: number | undefined,
  message: string,
): boolean {
  if (status === 429 || status === 503) return true;
  const m = message.toLowerCase();
  return (
    m.includes('high demand') ||
    m.includes('overloaded') ||
    m.includes('resource_exhausted')
  );
}

export function mapProviderCapacityError(
  status: number | undefined,
  message: string,
): HttpException | null {
  if (!isProviderCapacityFailure(status, message)) return null;
  return new HttpException(
    {
      message:
        'The AI provider is rate limited right now. No credits were ' +
        'charged — please try again in a moment.',
      reason: 'provider_rate_limited',
    },
    HttpStatus.TOO_MANY_REQUESTS,
  );
}

/**
 * Tagged 502 for a provider rejecting the *model id* (retired, unknown,
 * not a chat model). Distinct from key/auth failures so `/ai/validate`
 * no longer collapses these into an anonymous 500.
 */
export function mapModelScopedProviderError(
  status: number | undefined,
  message: string,
  model: string,
): HttpException | null {
  if (!isModelScopedProviderFailure(status, message)) return null;
  return new HttpException(
    {
      message:
        'The selected AI model is no longer available. Nothing was ' +
        'charged — please pick a different model and try again.',
      reason: 'provider_model_unavailable',
      model,
    },
    HttpStatus.BAD_GATEWAY,
  );
}
