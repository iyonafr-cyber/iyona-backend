import {
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
import { TOPUP_BY_ID, TopupPack } from './constants/plans';

/**
 * One-shot top-up purchases. Creates a Stripe Checkout Session for a
 * named pack. The actual credit grant happens in the Stripe webhook
 * when `checkout.session.completed` fires — that way a user can close
 * the tab mid-purchase and still get credits when their payment clears.
 */
@Injectable()
export class CreditsTopupService {
  private readonly logger = new Logger(CreditsTopupService.name);

  constructor(
    private readonly stripeService: StripeService,
    @InjectModel(User.name) private readonly userModel: Model<User>,
  ) {}

  async createCheckout(params: {
    userId: string;
    pack: TopupPack['id'];
    successUrl?: string;
    cancelUrl?: string;
  }): Promise<{ url: string; sessionId: string }> {
    const pack = TOPUP_BY_ID[params.pack];
    if (!pack) throw new NotFoundException(`Unknown topup pack ${params.pack}`);

    const stripe = this.getStripe();

    const user = await this.userModel
      .findById(new Types.ObjectId(params.userId))
      .select('email stripeCustomerId')
      .lean();
    if (!user) throw new NotFoundException('User not found');

    const customerId = await this.ensureCustomer(user, stripe);

    // Find the matching one-off price created by the Stripe seed
    // (tag: `credit_topup` + pack id).
    const priceId = await this.findTopupPriceId(stripe, pack.id);
    if (!priceId) {
      throw new ServiceUnavailableException(
        `Topup price for ${pack.id} not configured on Stripe. Run the stripe seed first.`,
      );
    }

    const successUrl =
      params.successUrl ??
      `${this.baseUrl()}/billing?topup=success&session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl =
      params.cancelUrl ?? `${this.baseUrl()}/billing?topup=cancelled`;

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: {
        userId: params.userId,
        topup_pack: pack.id,
        topup_credits: String(pack.credits),
      },
      payment_intent_data: {
        metadata: {
          userId: params.userId,
          topup_pack: pack.id,
          topup_credits: String(pack.credits),
        },
      },
    });

    if (!session.url) {
      throw new ServiceUnavailableException(
        'Stripe checkout did not return a URL',
      );
    }

    return { url: session.url, sessionId: session.id };
  }

  private async findTopupPriceId(
    stripe: Stripe,
    packId: TopupPack['id'],
  ): Promise<string | null> {
    const prices = await stripe.prices.search({
      query: `metadata["credit_topup"]:"true" AND metadata["topup_pack"]:"${packId}" AND active:"true"`,
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
