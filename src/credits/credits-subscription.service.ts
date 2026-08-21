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
import { User } from '../user/entities/user.entity';
import { PlanId, PLANS } from './constants/plans';

type BillingCycle = 'monthly' | 'yearly';

/**
 * Subscription-side Stripe helpers: create a Checkout session to subscribe
 * to a named plan, and mint a Billing Portal session so the user can
 * self-manage their subscription (cancel, swap payment method, etc.).
 *
 * Credit grants are still applied by `stripe-webhook.controller.ts` when
 * Stripe fires `invoice.paid` / `customer.subscription.*`.
 */
@Injectable()
export class CreditsSubscriptionService {
  private readonly logger = new Logger(CreditsSubscriptionService.name);

  constructor(
    private readonly stripeService: StripeService,
    @InjectModel(User.name) private readonly userModel: Model<User>,
  ) {}

  async createPlanCheckout(params: {
    userId: string;
    planId: PlanId;
    cycle?: BillingCycle;
    successUrl?: string;
    cancelUrl?: string;
  }): Promise<{ url: string; sessionId: string }> {
    if (params.planId === 'free') {
      throw new BadRequestException(
        'The Free plan cannot be checked out — downgrade via the portal instead.',
      );
    }
    if (!PLANS.some((p) => p.id === params.planId)) {
      throw new NotFoundException(`Unknown plan ${params.planId}`);
    }
    const cycle: BillingCycle = params.cycle ?? 'monthly';
    if (cycle !== 'monthly' && cycle !== 'yearly') {
      throw new BadRequestException(
        `Unsupported billing cycle ${String(cycle)}`,
      );
    }

    const stripe = this.getStripe();
    const user = await this.userModel
      .findById(new Types.ObjectId(params.userId))
      .select('email stripeCustomerId')
      .lean();
    if (!user) throw new NotFoundException('User not found');

    const customerId = await this.ensureCustomer(user, stripe);
    const priceId = await this.findPlanPriceId(stripe, params.planId, cycle);
    if (!priceId) {
      throw new ServiceUnavailableException(
        `No active ${cycle} price for plan ${params.planId}. Run the stripe seed first.`,
      );
    }

    const successUrl =
      params.successUrl ??
      `${this.baseUrl()}/billing?plan=success&session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl =
      params.cancelUrl ?? `${this.baseUrl()}/billing?plan=cancelled`;

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      client_reference_id: params.userId,
      subscription_data: {
        metadata: {
          userId: params.userId,
          planId: params.planId,
          billing_cycle: cycle,
        },
      },
      metadata: {
        userId: params.userId,
        planId: params.planId,
        billing_cycle: cycle,
      },
    });

    if (!session.url) {
      throw new ServiceUnavailableException(
        'Stripe checkout did not return a URL',
      );
    }
    return { url: session.url, sessionId: session.id };
  }

  async createPortalSession(params: {
    userId: string;
    returnUrl?: string;
  }): Promise<{ url: string }> {
    const stripe = this.getStripe();

    const user = await this.userModel
      .findById(new Types.ObjectId(params.userId))
      .select('email stripeCustomerId')
      .lean();
    if (!user) throw new NotFoundException('User not found');

    const customerId = await this.ensureCustomer(user, stripe);
    const returnUrl =
      params.returnUrl ?? `${this.baseUrl()}/billing?portal=return`;

    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl,
    });

    if (!session.url) {
      throw new ServiceUnavailableException(
        'Stripe billing portal did not return a URL',
      );
    }
    return { url: session.url };
  }

  private async findPlanPriceId(
    stripe: Stripe,
    planId: PlanId,
    cycle: BillingCycle,
  ): Promise<string | null> {
    const tag = `${planId}_${cycle}`;
    const prices = await stripe.prices.search({
      query: `metadata["price_tag"]:"${tag}" AND active:"true"`,
      limit: 1,
    });
    return prices.data[0]?.id ?? null;
  }

  private async ensureCustomer(
    user: Pick<User, 'email' | 'stripeCustomerId'> & { _id?: unknown },
    stripe: Stripe,
  ): Promise<string> {
    if (user.stripeCustomerId) return user.stripeCustomerId;

    const userObjectId = (user as { _id?: Types.ObjectId })._id;
    const customer = await stripe.customers.create({
      email: user.email,
      metadata: userObjectId
        ? { userId: userObjectId.toHexString() }
        : undefined,
    });

    if (userObjectId) {
      await this.userModel.findByIdAndUpdate(userObjectId, {
        $set: { stripeCustomerId: customer.id },
      });
    }
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
