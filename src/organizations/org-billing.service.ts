import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import Stripe from 'stripe';
import { StripeService } from '../stripe/stripe.service';
import {
  Organization,
  OrganizationDocument,
} from './entities/organization.entity';
import { OrgMember, OrgMemberDocument } from './entities/org-member.entity';
import { User } from '../user/entities/user.entity';
import { OrganizationsService } from './organizations.service';
import {
  ORG_PLANS,
  ORG_PLAN_BY_ID,
  type OrgPlanId,
} from './constants/org-plans';
import { withObservability } from '../common/observability';

interface CheckoutParams {
  orgId: string;
  userId: string;
  planId: Exclude<OrgPlanId, 'free'>;
  successUrl?: string;
  cancelUrl?: string;
}

/**
 * E9 — per-seat billing.
 *
 * Pattern:
 *   - One Stripe Subscription per Organization.
 *   - Single line item: price = the team plan's per-seat price, quantity =
 *     the org's seatCount (recomputed on every membership change).
 *   - Stripe is the source of truth for billing state. We mirror just
 *     enough on the Org doc (`stripeCustomerId`, `stripeSubscriptionId`,
 *     `plan`, `seatCount`) to render UI without hitting Stripe.
 *   - The webhook controller (`OrgBillingWebhookController`) updates the
 *     mirrored fields on `customer.subscription.*` events.
 */
@Injectable()
export class OrgBillingService {
  private readonly logger = new Logger(OrgBillingService.name);

  constructor(
    private readonly stripeService: StripeService,
    private readonly orgsService: OrganizationsService,
    @InjectModel(Organization.name)
    private readonly orgModel: Model<OrganizationDocument>,
    @InjectModel(OrgMember.name)
    private readonly memberModel: Model<OrgMemberDocument>,
    @InjectModel(User.name) private readonly userModel: Model<User>,
  ) {}

  // ── Public surface ─────────────────────────────────────────────

  listPlans() {
    return ORG_PLANS;
  }

  async getOrgBilling(orgId: string, userId: string) {
    await this.orgsService.requireMembership(orgId, userId);
    const org = await this.orgModel.findById(orgId).lean();
    if (!org) throw new NotFoundException('Organization not found');
    const seats = await this.memberModel.countDocuments({
      orgId: new Types.ObjectId(orgId),
    });
    return {
      plan: org.plan ?? 'free',
      seatCount: seats,
      mirroredSeatCount: org.seatCount ?? 1,
      stripeCustomerId: org.stripeCustomerId ?? null,
      stripeSubscriptionId: org.stripeSubscriptionId ?? null,
      planDetails: ORG_PLAN_BY_ID[org.plan ?? 'free'],
    };
  }

  /**
   * Create a Stripe Checkout session that subscribes the org to the
   * requested team plan. Quantity = current seat count.
   */
  async createCheckout(
    params: CheckoutParams,
  ): Promise<{ url: string; sessionId: string }> {
    const { orgId, userId, planId } = params;
    if (planId === ('free' as OrgPlanId)) {
      throw new BadRequestException(
        'Use cancelSubscription to drop down to the Free plan.',
      );
    }
    if (!ORG_PLAN_BY_ID[planId]) {
      throw new NotFoundException(`Unknown plan ${planId}`);
    }
    await this.orgsService.requireRole(orgId, userId, 'owner');

    const org = await this.orgModel.findById(orgId);
    if (!org) throw new NotFoundException('Organization not found');

    const seatCount = await this.recomputeSeatCount(orgId);
    const plan = ORG_PLAN_BY_ID[planId];
    if (plan.seatCap !== null && seatCount > plan.seatCap) {
      throw new BadRequestException(
        `Plan ${plan.name} caps at ${plan.seatCap} seats; this workspace has ${seatCount} members.`,
      );
    }

    const stripe = this.getStripe();
    const customerId = await this.ensureCustomer(org, userId, stripe);
    const priceId = await this.findPriceId(stripe, planId);
    if (!priceId) {
      throw new ServiceUnavailableException(
        `No active Stripe price for ${planId}. Set metadata.org_plan_id="${planId}" on a recurring USD price.`,
      );
    }

    const successUrl =
      params.successUrl ??
      `${this.baseUrl()}/billing?org=${orgId}&plan=success`;
    const cancelUrl =
      params.cancelUrl ??
      `${this.baseUrl()}/billing?org=${orgId}&plan=cancelled`;

    const session = await withObservability(
      'stripe.checkout.sessions.create',
      () =>
        stripe.checkout.sessions.create({
          mode: 'subscription',
          customer: customerId,
          line_items: [{ price: priceId, quantity: Math.max(seatCount, 1) }],
          success_url: successUrl,
          cancel_url: cancelUrl,
          client_reference_id: orgId,
          subscription_data: {
            metadata: {
              orgId,
              orgPlanId: planId,
              createdByUserId: userId,
            },
          },
          metadata: {
            orgId,
            orgPlanId: planId,
            createdByUserId: userId,
          },
        }),
      { orgId, planId, seatCount },
    );

    if (!session.url) {
      throw new ServiceUnavailableException(
        'Stripe checkout did not return a URL',
      );
    }
    return { url: session.url, sessionId: session.id };
  }

  async createPortalSession(
    orgId: string,
    userId: string,
    returnUrl?: string,
  ): Promise<{ url: string }> {
    await this.orgsService.requireRole(orgId, userId, 'owner');
    const org = await this.orgModel.findById(orgId);
    if (!org) throw new NotFoundException('Organization not found');
    const stripe = this.getStripe();
    const customerId = await this.ensureCustomer(org, userId, stripe);
    const session = await withObservability(
      'stripe.billingPortal.sessions.create',
      () =>
        stripe.billingPortal.sessions.create({
          customer: customerId,
          return_url:
            returnUrl ?? `${this.baseUrl()}/billing?org=${orgId}&portal=return`,
        }),
      { orgId },
    );
    if (!session.url) {
      throw new ServiceUnavailableException(
        'Stripe billing portal did not return a URL',
      );
    }
    return { url: session.url };
  }

  /**
   * Push the current member count to Stripe as the seat quantity. Idempotent
   * and safe to call from membership mutations.
   */
  async syncSeatsToStripe(orgId: string): Promise<void> {
    const org = await this.orgModel.findById(orgId);
    if (!org || !org.stripeSubscriptionId || org.plan === 'free') return;
    try {
      const stripe = this.getStripe();
      const sub = await withObservability(
        'stripe.subscriptions.retrieve',
        () => stripe.subscriptions.retrieve(org.stripeSubscriptionId),
        { orgId },
      );
      const seatCount = await this.recomputeSeatCount(orgId);
      const item = sub.items.data[0];
      if (!item) return;
      if (item.quantity !== seatCount) {
        await withObservability(
          'stripe.subscriptionItems.update',
          () =>
            stripe.subscriptionItems.update(item.id, {
              quantity: Math.max(seatCount, 1),
              proration_behavior: 'create_prorations',
            }),
          { orgId, seatCount },
        );
        org.seatCount = seatCount;
        await org.save();
        this.logger.log(
          `Synced ${orgId} seats to Stripe: quantity=${seatCount}`,
        );
      }
    } catch (err) {
      this.logger.warn(
        `Seat sync failed for ${orgId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  // ── Webhook handlers (called from controller) ──────────────────

  async applySubscriptionEvent(sub: Stripe.Subscription): Promise<void> {
    const orgId = sub.metadata?.orgId;
    if (!orgId || !Types.ObjectId.isValid(orgId)) return;
    const planId = sub.metadata?.orgPlanId as OrgPlanId | undefined;
    const item = sub.items.data[0];
    const seatCount = item?.quantity ?? 1;

    const updates: Record<string, unknown> = {
      stripeSubscriptionId: sub.id,
      seatCount,
    };
    if (sub.status === 'active' || sub.status === 'trialing') {
      if (planId) updates.plan = planId;
    } else if (
      sub.status === 'canceled' ||
      sub.status === 'unpaid' ||
      sub.status === 'incomplete_expired'
    ) {
      updates.plan = 'free';
      updates.stripeSubscriptionId = null;
    }
    await this.orgModel.updateOne(
      { _id: new Types.ObjectId(orgId) },
      { $set: updates },
    );
    this.logger.log(
      `Applied subscription ${sub.id} (${sub.status}) → org ${orgId}`,
    );
  }

  // ── Internals ──────────────────────────────────────────────────

  private async recomputeSeatCount(orgId: string): Promise<number> {
    const count = await this.memberModel.countDocuments({
      orgId: new Types.ObjectId(orgId),
    });
    await this.orgModel.updateOne(
      { _id: new Types.ObjectId(orgId) },
      { $set: { seatCount: count } },
    );
    return count;
  }

  private async findPriceId(
    stripe: Stripe,
    planId: OrgPlanId,
  ): Promise<string | null> {
    const prices = await stripe.prices.search({
      query: `metadata["org_plan_id"]:"${planId}" AND active:"true"`,
      limit: 1,
    });
    return prices.data[0]?.id ?? null;
  }

  private async ensureCustomer(
    org: OrganizationDocument,
    userId: string,
    stripe: Stripe,
  ): Promise<string> {
    if (org.stripeCustomerId) return org.stripeCustomerId;
    const owner = await this.userModel
      .findById(org.ownerId)
      .select('email')
      .lean();
    const customer = await stripe.customers.create({
      email: owner?.email ?? undefined,
      name: org.name,
      metadata: {
        orgId: String(org._id),
        ownerUserId: String(org.ownerId),
        actingUserId: userId,
      },
    });
    org.stripeCustomerId = customer.id;
    await org.save();
    return customer.id;
  }

  private baseUrl(): string {
    return (
      process.env.FRONTEND_BASE_URL?.replace(/\/$/, '') || 'https://jarvis.site'
    );
  }

  private getStripe(): Stripe {
    try {
      return this.stripeService.getClient();
    } catch {
      throw new ServiceUnavailableException(
        'Stripe is not configured. Set STRIPE_SECRET_KEY in the environment.',
      );
    }
  }
}
