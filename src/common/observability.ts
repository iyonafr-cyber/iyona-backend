/**
 * Tiny wrapper around external HTTP/SDK calls so every site that talks
 * to a third party (Stripe, WorkOS, Vercel, OpenAI, etc.) gets:
 *
 *   - a Sentry breadcrumb for the attempt,
 *   - a Sentry capture on failure (with operation tag),
 *   - a structured log line via the NestJS Logger (which routes
 *     through pino in production).
 *
 * Usage:
 *
 *   const subscription = await withObservability(
 *     'stripe.subscriptions.update',
 *     () => this.stripe.subscriptions.update(id, { ... }),
 *     { orgId },
 *   );
 *
 * Failures are re-thrown — this helper does NOT swallow errors, only
 * annotates them.
 */
import { Logger } from '@nestjs/common';
import * as Sentry from '@sentry/node';

const logger = new Logger('Observability');

export async function withObservability<T>(
  operation: string,
  fn: () => Promise<T>,
  context: Record<string, unknown> = {},
): Promise<T> {
  const start = Date.now();
  try {
    Sentry.addBreadcrumb({
      category: 'external',
      message: operation,
      level: 'info',
      data: context,
    });
    const result = await fn();
    logger.debug(
      `${operation} ok (${Date.now() - start}ms) ${
        Object.keys(context).length ? JSON.stringify(context) : ''
      }`,
    );
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(
      `${operation} failed after ${Date.now() - start}ms: ${message} ${
        Object.keys(context).length ? JSON.stringify(context) : ''
      }`,
    );
    try {
      Sentry.captureException(err, {
        tags: { operation },
        extra: context,
      });
    } catch {
      /* never let Sentry itself break the call */
    }
    throw err;
  }
}
