import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';
import { UserRole } from '../roles/roles.enum';

/**
 * Embedded record of an admin-issued ("manual") subscription. Used for
 * direct/cash sales outside of Stripe — see `ManualSubscriptionsService`.
 *
 * Presence of a non-expired record makes the user authoritative against
 * Stripe webhooks: while `expiresAt > now`, plan/credit mutations from
 * `customer.subscription.*` and `invoice.paid` are skipped so the manual
 * grant is not clobbered by an in-flight or stale Stripe subscription.
 */
@Schema({ _id: false })
export class ManualSubscription {
  @Prop({ type: String, required: true })
  planId: string;

  @Prop({ type: Date, required: true })
  startedAt: Date;

  // Indexed: `ManualSubscriptionsService.expireDue` cron filters by this.
  @Prop({ type: Date, required: true, index: true })
  expiresAt: Date;

  @Prop({ type: Number, required: true, min: 1 })
  months: number;

  // Stored as integer cents to avoid floating-point drift on totals.
  @Prop({ type: Number, required: true, min: 0 })
  amountPaidCents: number;

  // ISO-4217 currency code. Defaulted server-side; the admin form lets
  // operators pick from a small whitelist.
  @Prop({ type: String, required: true, default: 'USD' })
  currency: string;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'User',
    required: true,
  })
  grantedBy: Types.ObjectId;

  @Prop({ type: String, default: null })
  note: string | null;
}

export const ManualSubscriptionSchema =
  SchemaFactory.createForClass(ManualSubscription);

@Schema({ timestamps: true })
export class User extends Document {
  @Prop({ type: String, required: true, unique: true, index: true })
  email: string;

  @Prop({ type: String, default: null })
  password: string;

  @Prop({ type: String, default: null })
  verificationToken: string;

  @Prop({ type: Boolean, default: false })
  isVerified: boolean;

  @Prop({ type: Boolean, default: false })
  isDeleted: boolean;

  @Prop({ type: String, default: null })
  deletedUserEmail: string;

  /**
   * Active session identifiers. Each entry is the `uniqueId` stamped into the
   * access/refresh JWT pair at issuance time. AuthGuard verifies an access
   * token by checking its `uniqueId` is in this list (O(1) membership check).
   * This replaces the old pattern of storing raw refresh JWTs and decoding
   * every one on each request.\
   */
  @Prop({ type: [{ type: String }], default: [] })
  sessionIds: string[];

  @Prop({
    type: String,
    enum: UserRole,
    default: UserRole.USER,
  })
  role: UserRole;

  @Prop({ type: Boolean, default: false })
  githubConnected: boolean;

  // ──────────────────────────────────────────────────────────────
  // Credit system fields. See `src/credits/` for the full design.
  // `credits` is the monthly-reset pool; `topUpCredits` are one-off
  // purchases that never reset. The two are summed by `CreditsService.getBalance`
  // but tracked separately so refunds/resets only touch the right bucket.
  // ──────────────────────────────────────────────────────────────

  @Prop({ type: Number, default: 100 })
  credits: number;

  @Prop({ type: Number, default: 0 })
  topUpCredits: number;

  @Prop({ type: String, default: 'free' })
  planId: string;

  // Stripe customer id is looked up by the webhook on every invoice /
  // subscription event, so this MUST be indexed (sparse: null values are
  // common for users who haven't purchased yet and shouldn't bloat the
  // index).
  @Prop({ type: String, default: null, index: true, sparse: true })
  stripeCustomerId: string | null;

  @Prop({ type: String, default: null })
  stripeSubscriptionId: string | null;

  /**
   * When the monthly `credits` pool next resets. Checked lazily on every
   * `getBalance` call so we don't need a cron.
   */
  @Prop({ type: Date, default: () => new Date() })
  creditsRenewAt: Date;

  /**
   * Active admin-issued subscription, if any. Created via
   * `POST /admin/users/:id/manual-subscription` for direct/cash sales.
   * Null for the vast majority of users (Stripe or free tier).
   *
   * While `expiresAt > now`, the Stripe webhook handlers defer all
   * plan/credit mutations to this record — see `hasActiveManualOverride`
   * in `stripe-webhook.controller.ts`.
   */
  @Prop({ type: ManualSubscriptionSchema, default: null })
  manualSubscription: ManualSubscription | null;

  /**
   * Timestamp of the most recent successful authentication (email/password
   * or OAuth). Used by the admin panel for at-a-glance activity review and
   * for dormant-account reporting. Updated at login time only — refreshes
   * do not bump it so we track actual sign-ins, not token lifecycle noise.
   */
  @Prop({ type: Date, default: null })
  lastLoginAt: Date | null;

  /**
   * When `true`, AuthGuard rejects the token as if the session had been
   * revoked. Flipped via the admin "suspend user" flow. Kept separate from
   * `isDeleted` so the recovery path stays reversible without resurrecting
   * soft-deleted accounts.
   */
  @Prop({ type: Boolean, default: false })
  isSuspended: boolean;

  /**
   * Hashed password-reset token (SHA-256 of the raw token emailed to the
   * user). Storing only the hash means a dump of the collection can't be
   * turned into a password-reset attack.
   */
  @Prop({ type: String, default: null })
  passwordResetTokenHash?: string | null;

  /** Absolute expiry of the pending password-reset token. */
  @Prop({ type: Date, default: null })
  passwordResetTokenExpiresAt?: Date | null;

  /**
   * E8 — currently active organization (a.k.a. workspace). Set by the
   * org switcher and used by all collaboration-aware endpoints to
   * scope reads/writes. Null for users who haven't been provisioned
   * an org yet (lazy migration on first hit of an org-aware endpoint
   * spins up a personal org and back-fills this).
   */
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Organization',
    default: null,
  })
  currentOrgId?: Types.ObjectId | null;
}

export const UserSchema = SchemaFactory.createForClass(User);
