import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { MongoServerError } from 'mongodb';
import { User } from '../../user/entities/user.entity';
import {
  CreditLedger,
  CreditLedgerType,
} from '../../credits/entities/credit-ledger.entity';
import { getPlan, PlanId } from '../../credits/constants/plans';
import { CreditsService } from '../../credits/credits.service';

export interface GrantManualSubInput {
  planId: PlanId;
  months: number;
  amountPaidCents: number;
  currency: string;
  note?: string | null;
  overrideStripe?: boolean;
}

export interface ManualSubscriptionSummary {
  planId: PlanId;
  startedAt: Date;
  expiresAt: Date;
  months: number;
  amountPaidCents: number;
  currency: string;
  grantedBy: string;
  note: string | null;
  creditsGranted: number;
}

/**
 * Manual ("admin-issued") subscription grants. Used when a user pays
 * outside of Stripe (cash, bank transfer, sponsorship) and an admin
 * needs to provision them on a paid plan for a fixed number of months.
 *
 * Source of truth is `User.manualSubscription`. Presence of a non-expired
 * record both:
 *   - lets the hourly cron auto-revert the user back to free on expiry, and
 *   - tells the Stripe webhook handlers to leave this user alone.
 *
 * Credits are granted as a single lump sum (`months * plan.credits`),
 * with `creditsRenewAt` pinned to `expiresAt` so the existing
 * `monthlyResetCron` in CreditsService cannot accidentally reset the
 * pool mid-term.
 */
@Injectable()
export class ManualSubscriptionsService {
  private readonly logger = new Logger(ManualSubscriptionsService.name);

  constructor(
    @InjectModel(User.name) private readonly userModel: Model<User>,
    @InjectModel(CreditLedger.name)
    private readonly ledgerModel: Model<CreditLedger>,
    private readonly creditsService: CreditsService,
  ) {}

  // ──────────────────────────────────────────────────────────────
  // Grant
  // ──────────────────────────────────────────────────────────────

  async grant(
    userId: string,
    input: GrantManualSubInput,
    operatorId: string,
  ): Promise<ManualSubscriptionSummary> {
    if (!Types.ObjectId.isValid(userId)) {
      throw new NotFoundException('User not found');
    }
    if (!Types.ObjectId.isValid(operatorId)) {
      throw new BadRequestException('Operator id is invalid');
    }

    // Plan must exist and must not be 'free' — granting "free for 3
    // months" is meaningless and would just wipe paid credits.
    const plan = getPlan(input.planId);
    if (plan.id !== input.planId) {
      throw new BadRequestException(`Unknown plan ${input.planId}`);
    }
    if (plan.id === 'free') {
      throw new BadRequestException('Cannot grant the free plan manually');
    }

    if (!Number.isInteger(input.months) || input.months < 1) {
      throw new BadRequestException('months must be a positive integer');
    }
    if (!Number.isInteger(input.amountPaidCents) || input.amountPaidCents < 0) {
      throw new BadRequestException(
        'amountPaidCents must be a non-negative integer',
      );
    }

    const user = await this.userModel.findById(userId);
    if (!user) throw new NotFoundException('User not found');

    // If the user is already paying via Stripe we refuse by default.
    // The admin can pass `overrideStripe: true` to acknowledge the
    // double-billing risk and proceed anyway. The override does NOT
    // cancel the Stripe sub — the operator is expected to do that
    // out-of-band in the Stripe dashboard.
    if (user.stripeSubscriptionId && !input.overrideStripe) {
      throw new ConflictException({
        code: 'USER_HAS_ACTIVE_STRIPE_SUBSCRIPTION',
        message:
          'User has an active Stripe subscription. Cancel it in Stripe ' +
          'or pass overrideStripe=true to proceed.',
        stripeSubscriptionId: user.stripeSubscriptionId,
      });
    }

    const now = new Date();
    const expiresAt = this.addMonths(now, input.months);
    const creditsToGrant = input.months * plan.credits;

    await this.userModel.findByIdAndUpdate(userId, {
      $set: {
        planId: plan.id,
        // Lump sum: N months' worth of credits up front. The user can
        // burn them at any pace. Top-ups are untouched.
        credits: creditsToGrant,
        // Pin renewal to term end so monthlyResetCron does not reset
        // the lump-sum pool back to one month's quota mid-term.
        creditsRenewAt: expiresAt,
        manualSubscription: {
          planId: plan.id,
          startedAt: now,
          expiresAt,
          months: input.months,
          amountPaidCents: input.amountPaidCents,
          currency: input.currency.toUpperCase(),
          grantedBy: new Types.ObjectId(operatorId),
          note: input.note?.trim() || null,
        },
      },
    });

    const updated = await this.userModel
      .findById(userId)
      .select('credits topUpCredits manualSubscription')
      .lean();
    if (!updated) throw new NotFoundException('User not found');

    const referenceId = `admin:manual:grant:${userId}:${now.getTime()}`;
    await this.writeLedger({
      userId,
      type: 'manual_grant',
      amount: creditsToGrant,
      bucket: 'monthly',
      balanceAfter: (updated.credits ?? 0) + (updated.topUpCredits ?? 0),
      referenceId,
      metadata: {
        planId: plan.id,
        months: input.months,
        amountPaidCents: input.amountPaidCents,
        currency: input.currency.toUpperCase(),
        operatorId,
        note: input.note?.trim() || null,
        expiresAt: expiresAt.toISOString(),
        overrideStripe: !!input.overrideStripe,
      },
    });

    this.logger.log(
      `manual subscription granted user=${userId} plan=${plan.id} months=${input.months} expires=${expiresAt.toISOString()} operator=${operatorId}`,
    );

    return {
      planId: plan.id,
      startedAt: now,
      expiresAt,
      months: input.months,
      amountPaidCents: input.amountPaidCents,
      currency: input.currency.toUpperCase(),
      grantedBy: operatorId,
      note: input.note?.trim() || null,
      creditsGranted: creditsToGrant,
    };
  }

  // ──────────────────────────────────────────────────────────────
  // Revoke (manual or auto-expire)
  // ──────────────────────────────────────────────────────────────

  /**
   * Drop the user back to free immediately. `operatorId` is null for
   * cron-driven auto-expirations.
   */
  async revoke(
    userId: string,
    operatorId: string | null,
    reason: 'admin_revoked' | 'auto_expired',
  ): Promise<void> {
    if (!Types.ObjectId.isValid(userId)) {
      throw new NotFoundException('User not found');
    }

    const user = await this.userModel
      .findById(userId)
      .select('manualSubscription credits topUpCredits planId')
      .lean();
    if (!user) throw new NotFoundException('User not found');

    if (!user.manualSubscription) {
      // Nothing to revoke — make this a no-op so retries (e.g. cron
      // racing the admin button) don't double-write a ledger row.
      return;
    }

    const ts = Date.now();
    // downgradeToFree handles planId/credits reset and a primary
    // ledger row keyed off this referenceId. We pair it with a
    // manual_revoke entry that captures the operator + reason so
    // admin reports can filter on it cleanly.
    await this.creditsService.downgradeToFree(
      userId,
      `admin:manual:revoke:${userId}:${ts}`,
    );

    // Clear the override AFTER the downgrade so a concurrent webhook
    // delivery during this window still sees the override and skips.
    await this.userModel.findByIdAndUpdate(userId, {
      $unset: { manualSubscription: '' },
    });

    const fresh = await this.userModel
      .findById(userId)
      .select('credits topUpCredits')
      .lean();
    const balanceAfter = fresh
      ? (fresh.credits ?? 0) + (fresh.topUpCredits ?? 0)
      : 0;

    await this.writeLedger({
      userId,
      type: 'manual_revoke',
      // Zero amount — the credit reset itself was already logged by
      // downgradeToFree. This row exists to surface the *reason* in
      // the ledger UI without double-counting balances.
      amount: 0,
      bucket: 'monthly',
      balanceAfter,
      referenceId: `admin:manual:revoke-marker:${userId}:${ts}`,
      metadata: {
        reason,
        operatorId,
        previousPlanId: user.manualSubscription.planId,
        previousExpiresAt:
          user.manualSubscription.expiresAt instanceof Date
            ? user.manualSubscription.expiresAt.toISOString()
            : user.manualSubscription.expiresAt,
      },
    });

    this.logger.log(
      `manual subscription revoked user=${userId} reason=${reason} operator=${operatorId ?? 'cron'}`,
    );
  }

  // ──────────────────────────────────────────────────────────────
  // Cron — auto-expire
  // ──────────────────────────────────────────────────────────────

  /**
   * Hourly sweep: any user whose `manualSubscription.expiresAt` has
   * passed gets dropped to free. Hourly cadence is enough — the
   * worst-case "user got an extra hour of Pro" is acceptable and
   * far simpler than running this every minute.
   */
  @Cron(CronExpression.EVERY_HOUR)
  async expireDue(): Promise<void> {
    const now = new Date();
    const cursor = this.userModel
      .find({ 'manualSubscription.expiresAt': { $lte: now } })
      .select('_id')
      .cursor();

    let processed = 0;
    for await (const doc of cursor) {
      const id = String(doc._id);
      try {
        await this.revoke(id, null, 'auto_expired');
        processed += 1;
      } catch (err) {
        this.logger.error(
          `expireDue failed for user=${id}: ${(err as Error).message}`,
        );
      }
    }

    if (processed > 0) {
      this.logger.log(`expireDue revoked ${processed} manual subscription(s)`);
    }
  }

  // ──────────────────────────────────────────────────────────────
  // Internals
  // ──────────────────────────────────────────────────────────────

  /**
   * Add `months` to `from` calendar-style: setting the month index and
   * letting Date normalise (e.g. Jan 31 + 1 month → Mar 3, mirroring
   * Stripe's behaviour for short months).
   */
  private addMonths(from: Date, months: number): Date {
    const next = new Date(from);
    next.setMonth(next.getMonth() + months);
    return next;
  }

  private async writeLedger(entry: {
    userId: string;
    type: CreditLedgerType;
    amount: number;
    bucket: 'monthly' | 'topup';
    balanceAfter: number;
    referenceId: string;
    metadata: Record<string, unknown>;
  }): Promise<void> {
    try {
      await this.ledgerModel.create({
        userId: new Types.ObjectId(entry.userId),
        type: entry.type,
        amount: entry.amount,
        bucket: entry.bucket,
        balanceAfter: entry.balanceAfter,
        referenceId: entry.referenceId,
        metadata: entry.metadata,
      });
    } catch (err) {
      // Duplicate referenceId means a concurrent caller already wrote
      // this row. Treat as success — caller's mutation already happened.
      if (err instanceof MongoServerError && err.code === 11000) return;
      this.logger.error(
        `manual subscription ledger write failed: ${(err as Error).message}`,
      );
    }
  }
}
