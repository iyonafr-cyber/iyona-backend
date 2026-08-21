import {
  BadRequestException,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Logger,
  Optional,
  Post,
  Req,
  ServiceUnavailableException,
  forwardRef,
} from '@nestjs/common';
import { OrgBillingService } from '../organizations/org-billing.service';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request } from 'express';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import type Stripe from 'stripe';
import { Public } from '../auth/decorator/public.decorator';
import { StripeService } from '../stripe/stripe.service';
import { CreditsService } from './credits.service';
import { User } from '../user/entities/user.entity';
import { PLAN_BY_ID, PlanId } from './constants/plans';

/**
 * Stripe webhook receiver. Public (Stripe doesn't carry a JWT), but
 * every call is verified against STRIPE_WEBHOOK_SECRET before we touch
 * user balances.
 *
 * Raw request body is required for signature verification, so we skip
 * Nest's global JSON parser for this specific path — see `main.ts`.
 */
@ApiExcludeController()
@Controller('credits/stripe')
export class StripeWebhookController {
  private readonly logger = new Logger(StripeWebhookController.name);

  constructor(
    private readonly stripeService: StripeService,
    private readonly creditsService: CreditsService,
    @InjectModel(User.name) private readonly userModel: Model<User>,
    @Optional()
    @Inject(forwardRef(() => OrgBillingService))
    private readonly orgBillingService?: OrgBillingService,
  ) {}

  /**
   * E9 — if the subscription metadata says it belongs to an org, mirror
   * the state onto the Organization doc. We always run BOTH this and the
   * legacy user-billing path; user-billing safely no-ops when the
   * subscription metadata doesn't carry a userId.
   */
  private async maybeApplyOrgSubscription(
    sub: Stripe.Subscription,
  ): Promise<void> {
    if (!this.orgBillingService) return;
    if (!sub.metadata?.orgId) return;
    try {
      await this.orgBillingService.applySubscriptionEvent(sub);
    } catch (err) {
      this.logger.warn(
        `org subscription apply failed for ${sub.id}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  @Public()
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  async handle(
    @Req()
    req: Request & { body: Buffer | string | Record<string, unknown> },
  ): Promise<{ received: true }> {
    const signature = req.headers['stripe-signature'];
    if (!signature || Array.isArray(signature)) {
      throw new BadRequestException('Missing stripe-signature header');
    }
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret) {
      throw new ServiceUnavailableException(
        'STRIPE_WEBHOOK_SECRET is not configured',
      );
    }

    const stripe = this.stripeService.getClient();

    // `req.body` is a Buffer because this route bypasses the JSON parser.
    // The Stripe SDK accepts a Buffer or string for constructEvent.
    const rawBody = req.body as Buffer | string;

    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(rawBody, signature, secret);
    } catch (err) {
      this.logger.warn(
        `Stripe signature verification failed: ${(err as Error).message}`,
      );
      throw new BadRequestException('Invalid Stripe signature');
    }

    this.logger.log(`Stripe event ${event.id} (${event.type})`);

    try {
      switch (event.type) {
        case 'checkout.session.completed':
          await this.onCheckoutCompleted(event);
          break;
        case 'invoice.paid':
        case 'invoice.payment_succeeded':
          await this.onInvoicePaid(event);
          break;
        case 'customer.subscription.created':
        case 'customer.subscription.updated':
          await this.onSubscriptionUpserted(event);
          break;
        case 'customer.subscription.deleted':
          await this.onSubscriptionCancelled(event);
          break;
        default:
          // Unhandled events are fine — Stripe retries on non-2xx; we
          // ACK everything we can't route so it doesn't pile up.
          this.logger.debug(`Ignoring unhandled event ${event.type}`);
      }
    } catch (err) {
      // Return 200 even on handler failures after signature verification
      // passed, since returning a 500 would cause Stripe to retry, which
      // can lead to double-grants. Better to log and investigate.
      this.logger.error(
        `Handler for ${event.type} failed: ${(err as Error).message}`,
        (err as Error).stack,
      );
    }

    return { received: true };
  }

  // ──────────────────────────────────────────────────────────────

  private async onCheckoutCompleted(event: Stripe.Event): Promise<void> {
    const session = event.data.object as Stripe.Checkout.Session;
    const userId = session.metadata?.userId;
    if (!userId) {
      this.logger.warn(
        `checkout.session.completed ${session.id} missing userId metadata`,
      );
      return;
    }

    // Top-up packs arrive in `payment` mode; subscription creation comes
    // in `subscription` mode (those are handled by invoice.paid so we can
    // rely on the canonical invoice event for the grant).
    if (session.mode === 'payment' && session.metadata?.topup_pack) {
      const credits = Number(session.metadata.topup_credits);
      if (!Number.isFinite(credits) || credits <= 0) {
        this.logger.warn(
          `topup session ${session.id} has invalid credits metadata`,
        );
        return;
      }
      await this.creditsService.grantTopup({
        userId,
        // Use the stable session id as the reference so Stripe retries
        // of this event (same `event.id` is not guaranteed across
        // deliveries from replay) still collapse to one ledger row.
        referenceId: `stripe:topup:${session.id}`,
        credits,
        metadata: {
          eventType: 'checkout.session.completed',
          sessionId: session.id,
          pack: session.metadata.topup_pack,
          stripeEventId: event.id,
        },
      });
      // Persist the Stripe customer on the user if this was their first
      // purchase — but NEVER steal a customer id that's already bound
      // to a different user. That would let one user reroute another
      // user's future invoices to themselves via a crafted session.
      if (session.customer && typeof session.customer === 'string') {
        await this.safelyBindStripeCustomer(userId, session.customer);
      }
    }
  }

  private async onInvoicePaid(event: Stripe.Event): Promise<void> {
    const invoice = event.data.object as Stripe.Invoice;
    if (invoice.billing_reason === 'manual') return;

    // Resolve userId: prefer metadata on the subscription, fall back to
    // looking up our User by stripeCustomerId.
    const userId = await this.resolveUserIdFromInvoice(invoice);
    if (!userId) {
      this.logger.warn(`invoice.paid ${invoice.id} could not resolve userId`);
      return;
    }

    // Defer to admin-issued ("manual") subscriptions while active. Without
    // this skip, an in-flight Stripe invoice for a user we just granted
    // manually would overwrite plan + credits and effectively cancel the
    // operator's grant. The Stripe charge still happens — the operator
    // is expected to refund / cancel out-of-band in the Stripe dashboard.
    if (await this.hasActiveManualOverride(userId)) {
      this.logger.warn(
        `invoice.paid ${invoice.id} skipped: user=${userId} has active manual subscription override`,
      );
      return;
    }

    const planId = await this.resolvePlanIdFromInvoice(invoice);
    if (!planId) {
      this.logger.warn(
        `invoice.paid ${invoice.id} could not resolve plan — skipping grant`,
      );
      return;
    }

    // Stripe Node SDK >=18 moved the subscription pointer under
    // `parent.subscription_details.subscription`. Support both shapes so
    // we don't break if the SDK version shifts again.
    const subDetails = invoice.parent?.subscription_details;
    const rawSub = subDetails?.subscription;
    const subscriptionId =
      typeof rawSub === 'string' ? rawSub : (rawSub?.id ?? null);

    await this.creditsService.grantMonthly({
      userId,
      planId,
      stripeSubscriptionId: subscriptionId,
      stripeCustomerId:
        typeof invoice.customer === 'string' ? invoice.customer : null,
      // Invoice id is the most stable idempotency key for a recurring
      // charge — `event.id` differs between the initial delivery and a
      // replay from the CLI.
      referenceId: `stripe:invoice:${invoice.id}`,
    });
  }

  private async onSubscriptionUpserted(event: Stripe.Event): Promise<void> {
    const sub = event.data.object as Stripe.Subscription;
    // E9 — mirror org subscription state regardless of whether the
    // subscription has a user-plan mapping.
    await this.maybeApplyOrgSubscription(sub);

    const planId = this.planFromSubscription(sub);
    if (!planId) return;

    const userId = await this.resolveUserIdByCustomer(sub.customer);
    if (!userId) return;

    const customerId =
      typeof sub.customer === 'string' ? sub.customer : sub.customer.id;

    // Defer to admin-issued ("manual") subscriptions while active. We
    // still bind the customer id (so future webhooks resolve correctly)
    // but we leave plan/credits untouched — overwriting them would
    // silently undo the operator's grant.
    if (await this.hasActiveManualOverride(userId)) {
      this.logger.warn(
        `customer.subscription.${event.type.split('.').pop()} skipped: user=${userId} has active manual subscription override`,
      );
      await this.safelyBindStripeCustomer(userId, customerId);
      return;
    }

    // Keep plan/subscription bindings in sync with Stripe. We DO NOT
    // overwrite `stripeCustomerId` unconditionally — re-binding safety
    // is delegated to `safelyBindStripeCustomer`.
    await this.userModel.findByIdAndUpdate(userId, {
      $set: {
        planId,
        stripeSubscriptionId: sub.id,
      },
    });
    await this.safelyBindStripeCustomer(userId, customerId);

    // Stripe sends `customer.subscription.created` BEFORE the first
    // `invoice.paid` for trial / send_invoice users. Without an initial
    // grant those users would sit at the 100-credit free tier until the
    // first invoice lands — which for a 14-day trial is two weeks of
    // them wondering why their brand-new "Pro" plan shows free credits.
    // The grant is idempotent, so replaying the event is safe.
    if (
      event.type === 'customer.subscription.created' &&
      sub.status === 'active'
    ) {
      await this.creditsService.grantMonthly({
        userId,
        planId,
        stripeSubscriptionId: sub.id,
        stripeCustomerId: customerId,
        referenceId: `stripe:sub:${sub.id}:initial`,
      });
    }

    this.logger.log(
      `User ${userId} plan set to ${planId} via subscription ${sub.id}`,
    );
  }

  /**
   * Bind a Stripe customer id to a user, but refuse to overwrite if
   * another user already owns that customer id. Logs a warning so we
   * can investigate — this usually signals either duplicate signups
   * from the same card or a leaked session metadata.
   */
  private async safelyBindStripeCustomer(
    userId: string,
    customerId: string,
  ): Promise<void> {
    const existing = await this.userModel
      .findOne({ stripeCustomerId: customerId })
      .select('_id')
      .lean();
    if (existing && String(existing._id) !== userId) {
      this.logger.warn(
        `Refusing to bind stripeCustomerId ${customerId} to ${userId}; already bound to ${String(existing._id)}`,
      );
      return;
    }
    await this.userModel.findByIdAndUpdate(userId, {
      $set: { stripeCustomerId: customerId },
    });
  }

  private async onSubscriptionCancelled(event: Stripe.Event): Promise<void> {
    const sub = event.data.object as Stripe.Subscription;
    // E9 — drop the org back to free even if no userId mapping exists.
    await this.maybeApplyOrgSubscription(sub);

    const userId = await this.resolveUserIdByCustomer(sub.customer);
    if (!userId) return;
    // Defer to admin-issued ("manual") subscriptions while active. The
    // user's manual term continues; `ManualSubscriptionsService.expireDue`
    // will downgrade them when their term actually ends.
    if (await this.hasActiveManualOverride(userId)) {
      this.logger.warn(
        `customer.subscription.deleted ${sub.id} skipped: user=${userId} has active manual subscription override`,
      );
      return;
    }
    // Reference keyed by subscription id so replayed `subscription.deleted`
    // events idempotently collapse to one ledger row.
    await this.creditsService.downgradeToFree(
      userId,
      `stripe:sub:${sub.id}:downgrade`,
    );
  }

  /**
   * True if the user has an admin-issued ("manual") subscription that
   * has not yet expired. While true, all Stripe-driven plan/credit
   * mutations for this user are skipped so the operator's grant is not
   * overwritten by an in-flight or stale Stripe subscription.
   */
  private async hasActiveManualOverride(userId: string): Promise<boolean> {
    const user = await this.userModel
      .findById(userId)
      .select('manualSubscription.expiresAt')
      .lean();
    const expiresAt = user?.manualSubscription?.expiresAt;
    if (!expiresAt) return false;
    return new Date(expiresAt).getTime() > Date.now();
  }

  // ──────────────────────────────────────────────────────────────

  private async resolveUserIdFromInvoice(
    invoice: Stripe.Invoice,
  ): Promise<string | null> {
    const metadataUserId =
      invoice.parent?.subscription_details?.metadata?.userId;
    if (metadataUserId) return metadataUserId;
    return this.resolveUserIdByCustomer(invoice.customer);
  }

  private async resolveUserIdByCustomer(
    customer: string | Stripe.Customer | Stripe.DeletedCustomer | null,
  ): Promise<string | null> {
    if (!customer) return null;
    const customerId = typeof customer === 'string' ? customer : customer.id;
    const user = await this.userModel
      .findOne({ stripeCustomerId: customerId })
      .select('_id')
      .lean();
    return user ? String(user._id) : null;
  }

  private async resolvePlanIdFromInvoice(
    invoice: Stripe.Invoice,
  ): Promise<PlanId | null> {
    const priceItem = invoice.lines.data[0];
    const priceRef = priceItem?.pricing?.price_details?.price;
    if (!priceRef) return null;

    const stripe = this.stripeService.getClient();
    // `price` is either an id or an expanded Stripe.Price. Expand it if needed
    // so we can read metadata and fall back to product metadata.
    const price =
      typeof priceRef === 'string'
        ? await stripe.prices.retrieve(priceRef)
        : priceRef;

    const metadataPlan = (price.metadata as { plan_id?: string } | undefined)
      ?.plan_id;
    if (metadataPlan && PLAN_BY_ID[metadataPlan as PlanId]) {
      return metadataPlan as PlanId;
    }

    const productId =
      typeof price.product === 'string' ? price.product : price.product?.id;
    if (!productId) return null;
    const product = await stripe.products.retrieve(productId);
    const prodPlan = (product.metadata as { plan_id?: string }).plan_id;
    if (prodPlan && PLAN_BY_ID[prodPlan as PlanId]) {
      return prodPlan as PlanId;
    }
    return null;
  }

  private planFromSubscription(sub: Stripe.Subscription): PlanId | null {
    const item = sub.items.data[0];
    const planId = (item?.price?.metadata as { plan_id?: string } | undefined)
      ?.plan_id;
    if (planId && PLAN_BY_ID[planId as PlanId]) return planId as PlanId;
    return null;
  }
}
