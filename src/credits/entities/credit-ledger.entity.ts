import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';

export type CreditLedgerType =
  | 'grant'
  | 'reserve'
  | 'commit'
  | 'refund'
  | 'topup'
  | 'monthly_reset'
  | 'admin_adjust'
  // Admin-issued ("manual") subscription grants and the matching
  // revoke/auto-expire entries — see ManualSubscriptionsService.
  | 'manual_grant'
  | 'manual_revoke';

/**
 * Append-only credit movement log. Every change to `User.credits` /
 * `User.topUpCredits` writes one row here so we can reconstruct how a
 * user arrived at their current balance (critical for support + accounting).
 *
 * Invariant: for a given user, sum of `amount` over all ledger rows equals
 * their current total balance (`credits + topUpCredits`).
 */
@Schema({ timestamps: true, collection: 'credit_ledger' })
export class CreditLedger extends Document {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  })
  userId: Types.ObjectId;

  @Prop({
    type: String,
    required: true,
    enum: [
      'grant',
      'reserve',
      'commit',
      'refund',
      'topup',
      'monthly_reset',
      'admin_adjust',
      'manual_grant',
      'manual_revoke',
    ],
    index: true,
  })
  type: CreditLedgerType;

  /**
   * Signed delta applied to the user's balance.
   *   reserve/commit/admin_adjust negative deductions: negative
   *   grant/refund/topup/monthly_reset additions: positive
   */
  @Prop({ type: Number, required: true })
  amount: number;

  /** Which bucket the change affected. */
  @Prop({
    type: String,
    enum: ['monthly', 'topup'],
    default: 'monthly',
  })
  bucket: 'monthly' | 'topup';

  @Prop({ type: Number, required: true })
  balanceAfter: number;

  /**
   * Free-form pointer back to the originating entity — a usage log id, a
   * Stripe event id, a request id, etc. Not an ObjectId ref because the
   * referenced entity lives in different collections.
   */
  @Prop({ type: String, default: null, index: true })
  referenceId: string | null;

  @Prop({ type: MongooseSchema.Types.Mixed, default: {} })
  metadata: Record<string, unknown>;
}

export const CreditLedgerSchema = SchemaFactory.createForClass(CreditLedger);
CreditLedgerSchema.index({ userId: 1, createdAt: -1 });

// Idempotency guard for external grants (Stripe events, admin audits, etc.).
// Stripe delivers webhooks at-least-once, so without this index a retried
// `checkout.session.completed` or `invoice.paid` would double-credit the
// user. We use a partial filter so rows without a `referenceId` (internal
// reserve/commit/refund entries) do not collide.
CreditLedgerSchema.index(
  { referenceId: 1 },
  {
    unique: true,
    partialFilterExpression: { referenceId: { $type: 'string' } },
  },
);
