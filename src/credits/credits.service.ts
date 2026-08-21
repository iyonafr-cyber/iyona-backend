import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model, PipelineStage, Types } from 'mongoose';
import { MongoServerError } from 'mongodb';
import { randomUUID } from 'crypto';
import { User } from '../user/entities/user.entity';
import {
  CreditLedger,
  CreditLedgerType,
} from './entities/credit-ledger.entity';
import { UsageLog } from './entities/usage-log.entity';
import { CreditActionKey, getCreditAction } from './constants/credit-actions';
import { PLAN_BY_ID, PlanId, getPlan } from './constants/plans';
import { PricingService, TokenUsage } from './pricing.service';
import { InsufficientCreditsException } from './exceptions/insufficient-credits.exception';
import {
  parseSignupBonusCreditsEnv,
  signupWelcomeReferenceId,
} from './signup-bonus-credits';

export interface CreditBalance {
  credits: number;
  topUpCredits: number;
  total: number;
  planId: PlanId;
  planCredits: number;
  creditsRenewAt: Date;
}

export interface Reservation {
  id: string;
  userId: string;
  action: CreditActionKey;
  amount: number;
  fromTopup: number;
  fromMonthly: number;
  startedAt: number;
  requestId: string;
  projectId?: string;
}

export interface RunResult {
  usage: TokenUsage;
  projectId?: string;
  /** Optional override if the caller wants to force a minimum charge. */
  minCharge?: number;
}

/**
 * Central ledger + balance service.
 *
 * All balance mutations go through this service so:
 *   - every change produces a CreditLedger row (audit trail)
 *   - reservations are atomic (guarded `$inc` / `$gte`)
 *   - the monthly reset is applied lazily on read
 *
 * The `withCredits` helper is the one most callers use — it wraps a
 * provider call in reserve → run → commit/refund with a single line.
 */
@Injectable()
export class CreditsService {
  private readonly logger = new Logger(CreditsService.name);

  /**
   * How many failed retries of the same requestId we allow before hard-
   * rejecting the caller (research doc §4.3 — 20–30% of waste comes from
   * retry storms on bad prompts). Kept in memory because it's bounded to
   * a small window; on process restart the counter resets, which is fine.
   *
   * KNOWN LIMITATION: this Map is per-process. If we ever horizontally
   * scale the API beyond one instance, the retry counter becomes
   * approximate — each pod gets its own view of the same requestId. That
   * is acceptable for pre-launch (we only run a single instance); a
   * Redis-backed implementation is tracked for post-launch. To keep the
   * Map from growing unboundedly on a long-running process we cap it
   * with a simple LRU via `trackFailure()`.
   */
  private readonly retryLimit = 3;
  private readonly recentFailuresMax = 1000;
  private readonly recentFailures = new Map<string, number>();

  constructor(
    @InjectModel(User.name) private readonly userModel: Model<User>,
    @InjectModel(CreditLedger.name)
    private readonly ledgerModel: Model<CreditLedger>,
    @InjectModel(UsageLog.name)
    private readonly usageLogModel: Model<UsageLog>,
    private readonly pricing: PricingService,
  ) {}

  /**
   * Coerce user bucket fields (possibly null / string from legacy BSON)
   * to non-negative integers — same semantics as the previous inline
   * `Math.max(0, Math.trunc(Number(value ?? 0)) || 0)`.
   */
  private normalizeBucket(value: unknown): number {
    return Math.max(0, Math.trunc(Number(value ?? 0)) || 0);
  }

  private sumBuckets(credits: unknown, topUp: unknown): number {
    return this.normalizeBucket(credits) + this.normalizeBucket(topUp);
  }

  // ──────────────────────────────────────────────────────────────
  // Balance reads
  // ──────────────────────────────────────────────────────────────

  async getBalance(userId: string): Promise<CreditBalance> {
    await this.maybeMonthlyReset(userId);
    const user = await this.userModel
      .findById(userId)
      .select('credits topUpCredits planId creditsRenewAt stripeSubscriptionId')
      .lean();
    if (!user) throw new NotFoundException('User not found');

    const plan = getPlan(user.planId);
    const credits = this.normalizeBucket(user.credits);
    const topUpCredits = this.normalizeBucket(user.topUpCredits);
    return {
      credits,
      topUpCredits,
      total: credits + topUpCredits,
      planId: plan.id,
      planCredits: plan.credits,
      creditsRenewAt: user.creditsRenewAt ?? new Date(),
    };
  }

  async listUsage(userId: string, limit = 50) {
    return this.usageLogModel
      .find({ userId: new Types.ObjectId(userId) })
      .sort({ createdAt: -1 })
      .limit(Math.max(1, Math.min(limit, 200)))
      .lean();
  }

  // ──────────────────────────────────────────────────────────────
  // Monthly reset (lazy)
  // ──────────────────────────────────────────────────────────────

  /**
   * If the user's `creditsRenewAt` is in the past, top up their `credits`
   * to the plan quota and push the renewal date forward one month.
   * Top-up credits are NOT touched — they carry over indefinitely.
   *
   * Idempotent: concurrent calls race on the `creditsRenewAt` guard, so
   * only one of them will succeed in replacing the balance.
   */
  private async maybeMonthlyReset(userId: string): Promise<void> {
    const now = new Date();
    const user = await this.userModel
      .findOne({
        _id: new Types.ObjectId(userId),
        creditsRenewAt: { $lte: now },
      })
      .select('planId creditsRenewAt')
      .lean();
    if (!user) return;

    const plan = getPlan(user.planId);
    const nextRenewAt = this.addOneMonth(now);

    // Atomic swap — `creditsRenewAt` guard ensures we reset at most once
    // per renewal window even under concurrent traffic.
    const result = await this.userModel.findOneAndUpdate(
      {
        _id: new Types.ObjectId(userId),
        creditsRenewAt: user.creditsRenewAt,
      },
      {
        $set: {
          credits: plan.credits,
          creditsRenewAt: nextRenewAt,
        },
      },
      { new: true },
    );

    if (!result) return;

    await this.writeLedger({
      userId,
      type: 'monthly_reset',
      amount: plan.credits,
      bucket: 'monthly',
      balanceAfter: result.credits + result.topUpCredits,
      referenceId: `reset:${plan.id}:${now.toISOString().slice(0, 10)}`,
      metadata: { planId: plan.id },
    });
  }

  private addOneMonth(d: Date): Date {
    const next = new Date(d);
    next.setMonth(next.getMonth() + 1);
    return next;
  }

  // ──────────────────────────────────────────────────────────────
  // Reserve / commit / refund
  // ──────────────────────────────────────────────────────────────

  /**
   * Atomically deduct `amount` credits from the user. Drains the monthly
   * bucket first, then the top-up bucket — keeping monthly credits "use
   * it or lose it" the right way round.
   *
   * Returns a `Reservation` token to be passed to `commit` or `refund`.
   */
  async reserve(params: {
    userId: string;
    action: CreditActionKey;
    amount: number;
    requestId: string;
    projectId?: string;
  }): Promise<Reservation> {
    await this.maybeMonthlyReset(params.userId);

    // Retry storm short-circuit. If the same requestId has failed N times
    // already, refuse to reserve again until the client resets.
    const priorFailures =
      this.recentFailures.get(this.failKey(params.requestId)) ?? 0;
    if (priorFailures >= this.retryLimit) {
      throw new InsufficientCreditsException({
        action: params.action,
        required: params.amount,
        balance: 0,
      });
    }

    const userId = new Types.ObjectId(params.userId);
    const rawAmount = Number(params.amount);
    const amount = Number.isFinite(rawAmount)
      ? Math.max(1, Math.ceil(rawAmount))
      : 1;

    // Pull balances to decide how to split between monthly and top-up.
    const user = await this.userModel
      .findById(userId)
      .select('credits topUpCredits')
      .lean();
    if (!user) throw new NotFoundException('User not found');

    const monthlyBalance = this.normalizeBucket(user.credits);
    const topupBalance = this.normalizeBucket(user.topUpCredits);
    const total = monthlyBalance + topupBalance;
    if (total < amount) {
      throw new InsufficientCreditsException({
        action: params.action,
        required: amount,
        balance: total,
      });
    }

    let fromMonthly = Math.min(monthlyBalance, amount);
    let fromTopup = amount - fromMonthly;

    // Atomic guarded decrement. The `$gte` filters guarantee we never
    // go negative even under concurrent reservations.
    //
    // IMPORTANT: only include a bucket in the filter AND the $inc when we
    // actually deduct from it (`> 0`).
    //
    // Filter side: if `fromMonthly === 0` but we still require
    //   `credits: { $gte: 0 }`, MongoDB will NOT match documents where the
    //   `credits` field is missing or null — common for users who only ever
    //   received top-up / admin grants. They would see total balance > 0
    //   yet every reservation fails with HTTP 402.
    //
    // $inc side: `$inc: { credits: 0 }` on a document where the `credits`
    //   field is stored as `null` (possible in legacy / migrated rows) causes
    //   a MongoDB type error ("Cannot increment non-numeric type"), making
    //   findOneAndUpdate throw rather than return null — which previously
    //   propagated as an unhandled 500. Omitting the field entirely avoids
    //   touching a bucket we don't need to change.
    let updated = await this.userModel.findOneAndUpdate(
      {
        _id: userId,
        ...(fromMonthly > 0 ? { credits: { $gte: fromMonthly } } : {}),
        ...(fromTopup > 0 ? { topUpCredits: { $gte: fromTopup } } : {}),
      },
      {
        $inc: {
          ...(fromMonthly > 0 ? { credits: -fromMonthly } : {}),
          ...(fromTopup > 0 ? { topUpCredits: -fromTopup } : {}),
        },
      },
      { new: true },
    );

    if (!updated) {
      // Balance read says enough credits, but the guarded $inc did not
      // match — usually a race, or BSON types in Mongo (e.g. string) that
      // break numeric comparisons on the classic filter.
      const authoritative = await this.getBalance(params.userId);
      if (authoritative.total < amount) {
        throw new InsufficientCreditsException({
          action: params.action,
          required: amount,
          balance: authoritative.total,
        });
      }

      const snapshot = await this.userModel
        .findById(userId)
        .select('credits topUpCredits')
        .lean();
      if (!snapshot) throw new NotFoundException('User not found');

      const snapM = this.normalizeBucket(snapshot.credits);
      fromMonthly = Math.min(snapM, amount);
      fromTopup = amount - fromMonthly;

      const coercePipeline: PipelineStage[] = [
        {
          $set: {
            __c: { $toDouble: { $ifNull: ['$credits', 0] } },
            __t: { $toDouble: { $ifNull: ['$topUpCredits', 0] } },
          },
        },
        { $set: { __fm: { $min: ['$__c', amount] } } },
        {
          $set: {
            __ft: { $subtract: [amount, '$__fm'] },
            credits: { $subtract: ['$__c', '$__fm'] },
            topUpCredits: { $subtract: ['$__t', '$__ft'] },
          },
        },
        { $unset: ['__c', '__t', '__fm', '__ft'] },
      ];

      updated = await this.userModel.findOneAndUpdate(
        {
          _id: userId,
          $expr: {
            $gte: [
              {
                $add: [
                  { $toDouble: { $ifNull: ['$credits', 0] } },
                  { $toDouble: { $ifNull: ['$topUpCredits', 0] } },
                ],
              },
              amount,
            ],
          },
        },
        coercePipeline,
        { new: true },
      );

      if (!updated) {
        const afterPipeline = await this.getBalance(params.userId);
        throw new InsufficientCreditsException({
          action: params.action,
          required: amount,
          balance: afterPipeline.total,
        });
      }
    }

    const reservation: Reservation = {
      id: randomUUID(),
      userId: params.userId,
      action: params.action,
      amount,
      fromTopup,
      fromMonthly,
      startedAt: Date.now(),
      requestId: params.requestId,
      projectId: params.projectId,
    };

    await this.writeLedger({
      userId: params.userId,
      type: 'reserve',
      amount: -amount,
      bucket: fromTopup > 0 ? 'topup' : 'monthly',
      balanceAfter: this.sumBuckets(updated.credits, updated.topUpCredits),
      referenceId: reservation.id,
      metadata: {
        action: params.action,
        requestId: params.requestId,
        fromMonthly,
        fromTopup,
      },
    });

    return reservation;
  }

  /**
   * Finalize a reservation with the actual charge. Refunds the unused
   * portion back to the same buckets it was drained from.
   *
   * If the real charge exceeds the reservation (pathological case) we
   * cap the charge at the reserved amount — the user should never be
   * billed more than we told them was at stake.
   */
  async commit(
    reservation: Reservation,
    actualCredits: number,
  ): Promise<{ charged: number; refunded: number; balanceAfter: number }> {
    const charged = Math.min(
      Math.max(0, Math.ceil(actualCredits)),
      reservation.amount,
    );
    const refund = reservation.amount - charged;

    let balanceAfter = 0;

    if (refund > 0) {
      // Refund to the same buckets proportionally. We put the refund back
      // into the top-up bucket first (since reserves drain monthly first)
      // but only up to what we actually took from top-up.
      const toTopup = Math.min(refund, reservation.fromTopup);
      const toMonthly = refund - toTopup;

      const user = await this.userModel.findByIdAndUpdate(
        new Types.ObjectId(reservation.userId),
        {
          $inc: {
            credits: toMonthly,
            topUpCredits: toTopup,
          },
        },
        { new: true },
      );
      balanceAfter = user ? user.credits + user.topUpCredits : 0;

      await this.writeLedger({
        userId: reservation.userId,
        type: 'refund',
        amount: refund,
        bucket: toTopup > 0 ? 'topup' : 'monthly',
        balanceAfter,
        referenceId: reservation.id,
        metadata: { reason: 'reserve_over_estimate', toMonthly, toTopup },
      });
    } else {
      const user = await this.userModel
        .findById(reservation.userId)
        .select('credits topUpCredits')
        .lean();
      balanceAfter = user ? user.credits + user.topUpCredits : 0;
    }

    await this.writeLedger({
      userId: reservation.userId,
      type: 'commit',
      amount: -charged,
      bucket: reservation.fromTopup > 0 ? 'topup' : 'monthly',
      balanceAfter,
      referenceId: reservation.id,
      metadata: {
        action: reservation.action,
        requestId: reservation.requestId,
      },
    });

    // Success resets the retry counter for this requestId.
    this.recentFailures.delete(this.failKey(reservation.requestId));

    return { charged, refunded: refund, balanceAfter };
  }

  /**
   * Streaming-friendly commit: runs `commit` + writes the usage log in one
   * call. Use this when `withCredits()` can't wrap the operation (e.g. the
   * caller yields data to the client incrementally and needs to surface
   * the final charge in a terminal 'done' event).
   */
  async commitStreaming(params: {
    reservation: Reservation;
    usage: TokenUsage;
    actualCostUsd: number;
    actualCredits: number;
    status: 'success' | 'error' | 'timeout' | 'aborted';
    durationMs: number;
    errorMessage?: string;
    projectId?: string;
  }): Promise<{ charged: number; balanceAfter: number }> {
    const commitResult =
      params.status === 'success'
        ? await this.commit(params.reservation, params.actualCredits)
        : { charged: 0, refunded: params.reservation.amount, balanceAfter: 0 };

    if (params.status !== 'success') {
      await this.refund(
        params.reservation,
        params.errorMessage ?? params.status,
      );
    }

    await this.writeUsageLog({
      reservation: params.reservation,
      status: params.status,
      usage: params.usage,
      actualCostUsd: params.actualCostUsd,
      creditsCharged: commitResult.charged,
      durationMs: params.durationMs,
      projectId: params.projectId,
      errorMessage: params.errorMessage,
    });

    return {
      charged: commitResult.charged,
      balanceAfter: commitResult.balanceAfter,
    };
  }

  /** Full-refund path used when the provider call errors out. */
  async refund(reservation: Reservation, reason: string): Promise<number> {
    const user = await this.userModel.findByIdAndUpdate(
      new Types.ObjectId(reservation.userId),
      {
        $inc: {
          credits: reservation.fromMonthly,
          topUpCredits: reservation.fromTopup,
        },
      },
      { new: true },
    );
    const balanceAfter = user ? user.credits + user.topUpCredits : 0;

    await this.writeLedger({
      userId: reservation.userId,
      type: 'refund',
      amount: reservation.amount,
      bucket: reservation.fromTopup > 0 ? 'topup' : 'monthly',
      balanceAfter,
      referenceId: reservation.id,
      metadata: {
        reason,
        action: reservation.action,
        requestId: reservation.requestId,
      },
    });

    this.trackFailure(reservation.requestId);

    return balanceAfter;
  }

  // ──────────────────────────────────────────────────────────────
  // Grants (Stripe / admin / signup)
  // ──────────────────────────────────────────────────────────────

  async grantMonthly(params: {
    userId: string;
    planId: PlanId;
    stripeSubscriptionId?: string | null;
    stripeCustomerId?: string | null;
    referenceId: string;
  }): Promise<CreditBalance> {
    const plan = PLAN_BY_ID[params.planId];
    if (!plan) throw new NotFoundException(`Unknown plan ${params.planId}`);

    // Idempotency guard. Stripe delivers `invoice.paid` at-least-once
    // and `customer.subscription.*` can re-fire the same referenceId on
    // retries. If we've already written a ledger row for this reference
    // we short-circuit and return the current balance.
    if (await this.isReferenceProcessed(params.referenceId)) {
      this.logger.log(
        `grantMonthly ${params.referenceId} already processed — skipping`,
      );
      return this.getBalance(params.userId);
    }

    const nextRenewAt = this.addOneMonth(new Date());
    const user = await this.userModel.findByIdAndUpdate(
      new Types.ObjectId(params.userId),
      {
        $set: {
          planId: plan.id,
          credits: plan.credits,
          creditsRenewAt: nextRenewAt,
          ...(params.stripeSubscriptionId !== undefined && {
            stripeSubscriptionId: params.stripeSubscriptionId,
          }),
          ...(params.stripeCustomerId !== undefined && {
            stripeCustomerId: params.stripeCustomerId,
          }),
        },
      },
      { new: true },
    );
    if (!user) throw new NotFoundException('User not found');

    const written = await this.writeLedger({
      userId: params.userId,
      type: 'grant',
      amount: plan.credits,
      bucket: 'monthly',
      balanceAfter: user.credits + user.topUpCredits,
      referenceId: params.referenceId,
      metadata: {
        planId: plan.id,
        stripeSubscriptionId: params.stripeSubscriptionId,
      },
    });

    // Duplicate-key from the unique partial index means a concurrent
    // webhook delivery beat us to it. Roll back the balance overwrite —
    // the winning call already grants the right amount.
    if (!written) {
      this.logger.warn(
        `grantMonthly duplicate ledger for ${params.referenceId} — already granted`,
      );
    }

    return this.getBalance(params.userId);
  }

  async grantTopup(params: {
    userId: string;
    credits: number;
    referenceId: string;
    metadata?: Record<string, unknown>;
  }): Promise<CreditBalance> {
    // Same idempotency check as `grantMonthly`. We check BEFORE the
    // `$inc` so we don't double-credit on retried webhooks. The unique
    // partial index on `referenceId` is the backstop; if two pods race,
    // one wins, the other catches the duplicate-key in `writeLedger`
    // and we compensate by decrementing `topUpCredits` back down.
    if (await this.isReferenceProcessed(params.referenceId)) {
      this.logger.log(
        `grantTopup ${params.referenceId} already processed — skipping`,
      );
      return this.getBalance(params.userId);
    }

    const user = await this.userModel.findByIdAndUpdate(
      new Types.ObjectId(params.userId),
      { $inc: { topUpCredits: params.credits } },
      { new: true },
    );
    if (!user) throw new NotFoundException('User not found');

    const written = await this.writeLedger({
      userId: params.userId,
      type: 'topup',
      amount: params.credits,
      bucket: 'topup',
      balanceAfter: user.credits + user.topUpCredits,
      referenceId: params.referenceId,
      metadata: params.metadata ?? {},
    });

    if (!written) {
      // Concurrent webhook beat us to the ledger row — undo our
      // balance mutation to avoid double-crediting.
      await this.userModel.findByIdAndUpdate(
        new Types.ObjectId(params.userId),
        { $inc: { topUpCredits: -params.credits } },
      );
      this.logger.warn(
        `grantTopup duplicate ledger for ${params.referenceId} — rolled back increment`,
      );
    }

    return this.getBalance(params.userId);
  }

  /**
   * Public marketing value — same parsing as `grantSignupWelcomeBonus`.
   */
  getSignupBonusCreditsOffer(): number {
    return parseSignupBonusCreditsEnv();
  }

  /**
   * Idempotent one-time top-up for new signups. Returns credits granted this
   * call (0 if disabled, already granted, or ledger write failed after rollback).
   */
  async grantSignupWelcomeBonus(userId: string): Promise<number> {
    const amount = parseSignupBonusCreditsEnv();
    if (amount <= 0) return 0;

    const referenceId = signupWelcomeReferenceId(userId);
    if (await this.isReferenceProcessed(referenceId)) return 0;

    try {
      await this.grantTopup({
        userId,
        credits: amount,
        referenceId,
        metadata: { reason: 'signup_welcome' },
      });
    } catch (err) {
      this.logger.error(
        `grantSignupWelcomeBonus failed for ${userId}: ${(err as Error).message}`,
      );
      return 0;
    }

    return (await this.isReferenceProcessed(referenceId)) ? amount : 0;
  }

  async downgradeToFree(userId: string, referenceId: string): Promise<void> {
    if (await this.isReferenceProcessed(referenceId)) {
      this.logger.log(
        `downgradeToFree ${referenceId} already processed — skipping`,
      );
      return;
    }

    const free = PLAN_BY_ID.free;
    await this.userModel.findByIdAndUpdate(new Types.ObjectId(userId), {
      $set: {
        planId: 'free',
        stripeSubscriptionId: null,
        credits: free.credits,
        creditsRenewAt: this.addOneMonth(new Date()),
      },
    });

    await this.writeLedger({
      userId,
      type: 'grant',
      amount: free.credits,
      bucket: 'monthly',
      balanceAfter: free.credits,
      referenceId,
      metadata: { planId: 'free', reason: 'subscription_cancelled' },
    });
  }

  /**
   * Admin-only utility. Accepts a signed delta — positive adds credits,
   * negative deducts. Always writes a ledger row so the adjustment is
   * visible in audit history.
   */
  async adminAdjust(params: {
    userId: string;
    amount: number;
    bucket?: 'monthly' | 'topup';
    reason: string;
    operatorId: string;
  }): Promise<CreditBalance> {
    const bucket = params.bucket ?? 'topup';
    const field = bucket === 'monthly' ? 'credits' : 'topUpCredits';
    const user = await this.userModel.findByIdAndUpdate(
      new Types.ObjectId(params.userId),
      { $inc: { [field]: params.amount } },
      { new: true },
    );
    if (!user) throw new NotFoundException('User not found');

    await this.writeLedger({
      userId: params.userId,
      type: 'admin_adjust',
      amount: params.amount,
      bucket,
      balanceAfter: user.credits + user.topUpCredits,
      referenceId: `admin:${params.operatorId}:${Date.now()}`,
      metadata: { reason: params.reason, operatorId: params.operatorId },
    });

    return this.getBalance(params.userId);
  }

  // ──────────────────────────────────────────────────────────────
  // High-level wrapper — the one every caller should prefer.
  // ──────────────────────────────────────────────────────────────

  /**
   * Reserve → run → commit/refund + usage-log in one call.
   *
   *   `reserveAmount` is an upper bound (e.g. estimated from max_output_tokens).
   *   `run()` must return `{ usage }` — the real token counts. We then
   *   recompute the authoritative credit charge via `PricingService` and
   *   commit that amount, refunding the delta.
   *
   *   If `run()` throws, the full reservation is refunded.
   */
  async withCredits<T>(
    params: {
      userId: string;
      action: CreditActionKey;
      reserveAmount: number;
      requestId: string;
      projectId?: string;
    },
    run: () => Promise<T & RunResult>,
  ): Promise<{
    result: T;
    usage: TokenUsage;
    creditsCharged: number;
    balanceAfter: number;
  }> {
    const config = getCreditAction(params.action);
    const minReserve = Math.max(params.reserveAmount, config.minReserve);

    const reservation = await this.reserve({
      userId: params.userId,
      action: params.action,
      amount: minReserve,
      requestId: params.requestId,
      projectId: params.projectId,
    });

    const startedAt = Date.now();

    try {
      const result = await run();
      const { credits, usdCost } = this.pricing.computeCredits(result.usage);
      const charged = result.minCharge
        ? Math.max(credits, result.minCharge)
        : credits;
      const commitResult = await this.commit(reservation, charged);

      await this.writeUsageLog({
        reservation,
        status: 'success',
        usage: result.usage,
        actualCostUsd: usdCost,
        creditsCharged: commitResult.charged,
        durationMs: Date.now() - startedAt,
        projectId: result.projectId ?? params.projectId,
      });

      return {
        result,
        usage: result.usage,
        creditsCharged: commitResult.charged,
        balanceAfter: commitResult.balanceAfter,
      };
    } catch (err) {
      await this.refund(
        reservation,
        err instanceof Error ? err.message : 'unknown_error',
      );
      await this.writeUsageLog({
        reservation,
        status: 'error',
        errorMessage: err instanceof Error ? err.message : 'unknown_error',
        durationMs: Date.now() - startedAt,
      });
      throw err;
    }
  }

  // ──────────────────────────────────────────────────────────────
  // Margin / analytics
  // ──────────────────────────────────────────────────────────────

  async aggregateMargin(params: { days: number }): Promise<{
    window: string;
    totalCreditsCharged: number;
    totalCostUsd: number;
    creditsPerUsdImplied: number;
    byModel: Array<{
      model: string;
      provider: string;
      requests: number;
      credits: number;
      costUsd: number;
    }>;
  }> {
    const since = new Date(Date.now() - params.days * 24 * 60 * 60 * 1000);
    const rows = await this.usageLogModel.aggregate<{
      _id: { model: string; provider: string };
      requests: number;
      credits: number;
      costUsd: number;
    }>([
      { $match: { createdAt: { $gte: since }, status: 'success' } },
      {
        $group: {
          _id: { model: '$modelName', provider: '$provider' },
          requests: { $sum: 1 },
          credits: { $sum: '$creditsCharged' },
          costUsd: { $sum: '$actualCostUsd' },
        },
      },
    ]);

    const totals = rows.reduce(
      (acc, r) => {
        acc.credits += r.credits;
        acc.costUsd += r.costUsd;
        return acc;
      },
      { credits: 0, costUsd: 0 },
    );

    return {
      window: `${params.days}d`,
      totalCreditsCharged: totals.credits,
      totalCostUsd: totals.costUsd,
      creditsPerUsdImplied: totals.costUsd
        ? totals.credits / totals.costUsd
        : 0,
      byModel: rows.map((r) => ({
        model: r._id.model,
        provider: r._id.provider,
        requests: r.requests,
        credits: r.credits,
        costUsd: r.costUsd,
      })),
    };
  }

  // ──────────────────────────────────────────────────────────────
  // Internals
  // ──────────────────────────────────────────────────────────────

  private failKey(requestId: string): string {
    return `f:${requestId}`;
  }

  /**
   * Bounded LRU tracker for request-level retry storms. We use insertion
   * order (Map preserves it) and evict the oldest entry whenever we go
   * over `recentFailuresMax`. Cheap, good enough, and can't leak memory.
   */
  private trackFailure(requestId: string): void {
    const key = this.failKey(requestId);
    const current = this.recentFailures.get(key) ?? 0;
    // Delete + re-set so the key bubbles to the newest insertion slot.
    this.recentFailures.delete(key);
    this.recentFailures.set(key, current + 1);
    if (this.recentFailures.size > this.recentFailuresMax) {
      const oldest = this.recentFailures.keys().next().value as
        | string
        | undefined;
      if (oldest !== undefined) this.recentFailures.delete(oldest);
    }
  }

  /** True if a ledger row with this `referenceId` already exists. */
  private async isReferenceProcessed(referenceId: string): Promise<boolean> {
    if (!referenceId) return false;
    const hit = await this.ledgerModel
      .findOne({ referenceId })
      .select('_id')
      .lean();
    return !!hit;
  }

  /**
   * Cron-driven monthly reset safety net. Hits any users whose
   * `creditsRenewAt` is already in the past. The lazy `maybeMonthlyReset`
   * on read still runs — this cron just makes sure a completely
   * inactive user still gets their plan credits refilled each cycle, so
   * the chip doesn't show "25 / 500" for a week while they're logged in
   * but not calling any AI endpoints.
   */
  @Cron(CronExpression.EVERY_6_HOURS)
  async monthlyResetCron(): Promise<void> {
    const now = new Date();
    const cursor = this.userModel
      .find({ creditsRenewAt: { $lte: now } })
      .select('_id')
      .cursor();
    let processed = 0;
    for await (const doc of cursor) {
      try {
        await this.maybeMonthlyReset(String(doc._id));
        processed += 1;
      } catch (err) {
        this.logger.error(
          `monthlyResetCron failed for ${String(doc._id)}: ${(err as Error).message}`,
        );
      }
    }
    if (processed > 0) {
      this.logger.log(`monthlyResetCron processed ${processed} user(s)`);
    }
  }

  private async writeLedger(entry: {
    userId: string;
    type: CreditLedgerType;
    amount: number;
    bucket: 'monthly' | 'topup';
    balanceAfter: number;
    referenceId?: string | null;
    metadata?: Record<string, unknown>;
  }): Promise<boolean> {
    try {
      await this.ledgerModel.create({
        userId: new Types.ObjectId(entry.userId),
        type: entry.type,
        amount: entry.amount,
        bucket: entry.bucket,
        balanceAfter: entry.balanceAfter,
        referenceId: entry.referenceId ?? null,
        metadata: entry.metadata ?? {},
      });
      return true;
    } catch (err) {
      if (err instanceof MongoServerError && err.code === 11000) {
        // Duplicate `referenceId` — another webhook delivery already
        // wrote the row. Not an error; caller compensates if needed.
        return false;
      }
      // Ledger writes should never fail a user request — log and move on
      // (the $inc on the user doc is the source of truth for balances).
      this.logger.error(`Ledger write failed: ${(err as Error).message}`);
      return false;
    }
  }

  private async writeUsageLog(params: {
    reservation: Reservation;
    status: 'success' | 'error' | 'timeout' | 'aborted';
    usage?: TokenUsage;
    actualCostUsd?: number;
    creditsCharged?: number;
    errorMessage?: string;
    durationMs: number;
    projectId?: string;
  }): Promise<void> {
    try {
      await this.usageLogModel.create({
        userId: new Types.ObjectId(params.reservation.userId),
        projectId: params.projectId ?? null,
        action: params.reservation.action,
        provider: params.usage?.provider ?? 'openai',
        modelName: params.usage?.model ?? 'unknown',
        inputTokens: params.usage?.inputTokens ?? 0,
        outputTokens: params.usage?.outputTokens ?? 0,
        actualCostUsd: params.actualCostUsd ?? 0,
        creditsReserved: params.reservation.amount,
        creditsCharged: params.creditsCharged ?? 0,
        status: params.status,
        errorMessage: params.errorMessage ?? null,
        durationMs: params.durationMs,
        requestId: params.reservation.requestId,
      });
    } catch (err) {
      this.logger.error(`Usage log write failed: ${(err as Error).message}`);
    }
  }
}
