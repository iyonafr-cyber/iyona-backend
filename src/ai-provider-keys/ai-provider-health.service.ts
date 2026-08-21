import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AiProviderKeysService } from './ai-provider-keys.service';
import {
  AiProviderKey,
  type AiProviderKeyHealthStatus,
} from './entities/ai-provider-key.entity';

const MAX_CONSECUTIVE_BEFORE_DISABLE = 8;

/**
 * True when a failure is about the *model we asked for*, not the key.
 * Kept as a module-level function so `/ai/validate` can map the same
 * cases to a tagged 502 instead of an anonymous 500.
 */
export function isModelScopedProviderFailure(
  status: number | undefined,
  message: string,
): boolean {
  if (status === 404) return true;
  const m = message.toLowerCase();
  return (
    m.includes('not_found_error') ||
    m.includes('model_not_found') ||
    m.includes('does not exist') ||
    m.includes('has been deprecated') ||
    // Gemini TTS/audio models accept generateContent but reject TEXT.
    m.includes('response modalities') ||
    /\bmodel:\s/.test(m)
  );
}

@Injectable()
export class AiProviderHealthService {
  private readonly logger = new Logger(AiProviderHealthService.name);

  constructor(
    @InjectModel(AiProviderKey.name)
    private readonly keyModel: Model<AiProviderKey>,
    @Inject(forwardRef(() => AiProviderKeysService))
    private readonly keys: AiProviderKeysService,
  ) {}

  /**
   * True when a failure is about the *model we asked for*, not the key.
   *
   * A 404 `not_found_error` means the model id doesn't exist — the key is
   * perfectly good. Demoting the key on one of these is how a single bad
   * catalog id took the whole platform down: a retired Anthropic alias
   * returned 404, the key got flagged `rate_limited`, the provider dropped
   * out of routing, and with no provider left the router threw
   * "No AI provider configured" on every request. Never let a model-scoped
   * error condemn a key.
   */
  isModelScopedFailure(status: number | undefined, message: string): boolean {
    return isModelScopedProviderFailure(status, message);
  }

  /**
   * True only when the provider is telling us something about *this
   * credential* — auth, quota, or rate limiting.
   *
   * The old code defaulted the other way: any unrecognised failure fell
   * through `classifyHttpStatus` to `rate_limited`, so errors that had
   * nothing to do with the key demoted it out of routing. All three keys on
   * this deployment were knocked out that way, each by a different non-key
   * error — a retired model id (404), a non-chat model routed to
   * chat/completions, and the Anthropic SDK refusing a large non-streaming
   * request client-side. Since unhealthy keys are excluded from routing and
   * only `recordSuccess` restores them, none could recover, and the router
   * ended up with no providers at all.
   *
   * Defaulting to "not the key's fault" means a genuinely broken key fails
   * loudly on every attempt instead of silently disappearing — a far better
   * failure mode than a platform-wide outage traced to one bad model id.
   */
  isKeyFault(status: number | undefined, message: string): boolean {
    if (
      status === 401 ||
      status === 403 ||
      status === 429 ||
      status === 402
    ) {
      return true;
    }
    // Anthropic reports an exhausted account balance as a *400*, not a 402:
    //   400 invalid_request_error "Your credit balance is too low to access
    //   the Anthropic API. Please go to Plans & Billing..."
    // Without this branch the key stays `healthy` forever while every single
    // request through it fails, which is exactly how a live deployment ended
    // up serving anonymous 500s from /ai/validate with a green key. A blanket
    // `status === 400` would undo the fix documented above (malformed-request
    // 400s must never condemn a key), so match only on billing wording.
    if (status === 400 && this.isBillingMessage(message)) {
      return true;
    }
    // A client-side throw has no status; fall back to the message, but only
    // for phrases that unambiguously describe a credential problem.
    if (status !== undefined) return false;
    const m = message.toLowerCase();
    return (
      m.includes('incorrect api key') ||
      m.includes('invalid api key') ||
      m.includes('invalid x-api-key') ||
      m.includes('unauthorized') ||
      m.includes('authentication') ||
      m.includes('quota') ||
      m.includes('billing') ||
      m.includes('exceeded your') ||
      m.includes('insufficient_quota') ||
      m.includes('resource_exhausted') ||
      m.includes('rate limit') ||
      m.includes('too many')
    );
  }

  /**
   * Unambiguous "this account cannot pay for the call" wording. Deliberately
   * narrow: only phrases no malformed-request error would ever contain.
   */
  private isBillingMessage(message: string): boolean {
    const m = message.toLowerCase();
    return (
      m.includes('credit balance is too low') ||
      m.includes('purchase credits') ||
      m.includes('plans & billing') ||
      m.includes('insufficient_quota') ||
      m.includes('insufficient credits') ||
      m.includes('billing')
    );
  }

  classifyHttpStatus(status: number | undefined): AiProviderKeyHealthStatus {
    if (status === 401 || status === 403) return 'invalid';
    if (status === 429) return 'rate_limited';
    if (status === 402 || status === 400) return 'quota_exceeded';
    return 'rate_limited';
  }

  classifyMessage(message: string): AiProviderKeyHealthStatus {
    const m = message.toLowerCase();
    if (
      m.includes('incorrect api key') ||
      m.includes('invalid api key') ||
      m.includes('invalid x-api-key') ||
      m.includes('unauthorized') ||
      m.includes('authentication')
    ) {
      return 'invalid';
    }
    if (
      m.includes('quota') ||
      m.includes('billing') ||
      m.includes('exceeded your') ||
      m.includes('insufficient_quota') ||
      m.includes('resource_exhausted')
    ) {
      return 'quota_exceeded';
    }
    if (
      m.includes('rate limit') ||
      m.includes('429') ||
      m.includes('too many')
    ) {
      return 'rate_limited';
    }
    return 'rate_limited';
  }

  async recordSuccess(keyId: string): Promise<void> {
    if (!Types.ObjectId.isValid(keyId)) return;
    await this.keyModel
      .updateOne(
        { _id: new Types.ObjectId(keyId) },
        {
          $set: {
            healthStatus: 'healthy',
            consecutiveFailures: 0,
            lastFailureReason: null,
          },
        },
      )
      .exec();
    this.keys.invalidateCacheSignal();
  }

  async recordFailure(
    keyId: string,
    err: unknown,
    httpStatus?: number,
  ): Promise<void> {
    if (!Types.ObjectId.isValid(keyId)) return;
    const message =
      err instanceof Error
        ? err.message
        : typeof err === 'string'
          ? err
          : 'error';
    // Only a credential-level signal may demote a key. Model ids, request
    // shape, and transport errors leave health untouched so the provider
    // stays routable.
    if (!this.isKeyFault(httpStatus, message)) {
      this.logger.warn(
        `Non-key provider failure keyId=${keyId} status=${httpStatus ?? 'n/a'} ` +
          `msg=${message.slice(0, 200)} — key health left unchanged ` +
          `(look at the model id or request, not the key)`,
      );
      return;
    }

    let health: AiProviderKeyHealthStatus = 'rate_limited';
    if (httpStatus !== undefined) {
      health = this.classifyHttpStatus(httpStatus);
    } else {
      health = this.classifyMessage(message);
    }

    const doc = await this.keyModel.findById(keyId).lean();
    const prev = (doc?.consecutiveFailures ?? 0) + 1;
    const disable =
      prev >= MAX_CONSECUTIVE_BEFORE_DISABLE && health !== 'invalid';
    const finalHealth: AiProviderKeyHealthStatus = disable
      ? 'disabled'
      : health;

    await this.keyModel
      .updateOne(
        { _id: new Types.ObjectId(keyId) },
        {
          $set: {
            healthStatus: finalHealth,
            lastFailureAt: new Date(),
            lastFailureReason: message.slice(0, 500),
            consecutiveFailures: prev,
          },
        },
      )
      .exec();

    this.keys.invalidateCacheSignal();

    this.logger.warn(
      `Provider key failure keyId=${keyId} health=${finalHealth} status=${httpStatus ?? 'n/a'} msg=${message.slice(0, 200)}`,
    );
  }

  /**
   * Admin "Test key" / health probe only: persist classified health without
   * bumping consecutiveFailures (avoids disabling keys from repeated UI checks).
   */
  async applyProbeFailure(
    keyId: string,
    err: unknown,
    httpStatus?: number,
  ): Promise<void> {
    if (!Types.ObjectId.isValid(keyId)) return;
    const message =
      err instanceof Error
        ? err.message
        : typeof err === 'string'
          ? err
          : 'error';
    // Same rule as `recordFailure`: a probe that fails on its target model or
    // request shape says nothing about the credential.
    if (!this.isKeyFault(httpStatus, message)) {
      this.logger.warn(
        `Probe hit a non-key error keyId=${keyId} status=${httpStatus ?? 'n/a'} ` +
          `msg=${message.slice(0, 200)} — key health left unchanged`,
      );
      return;
    }

    const health: AiProviderKeyHealthStatus =
      httpStatus !== undefined
        ? this.classifyHttpStatus(httpStatus)
        : this.classifyMessage(message);

    await this.keyModel
      .updateOne(
        { _id: new Types.ObjectId(keyId) },
        {
          $set: {
            healthStatus: health,
            lastFailureAt: new Date(),
            lastFailureReason: message.slice(0, 500),
          },
        },
      )
      .exec();

    this.keys.invalidateCacheSignal();

    this.logger.warn(
      `Provider key probe failed keyId=${keyId} health=${health} status=${httpStatus ?? 'n/a'} msg=${message.slice(0, 200)}`,
    );
  }
}
