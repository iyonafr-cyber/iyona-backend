import { Injectable, Logger } from '@nestjs/common';
import Stripe from 'stripe';
import { StripeService } from './stripe.service';
import {
  PLANS,
  PlanDefinition,
  PlanId,
  TOPUP_PACKS,
  TopupPack,
} from '../credits/constants/plans';

export type SeedActionStatus = 'created' | 'skipped';

export interface SeedPlanResult {
  planId: PlanId;
  planName: string;
  productId: string;
  product: SeedActionStatus;
  monthlyPriceId: string | null;
  monthly: SeedActionStatus | 'n_a';
  yearlyPriceId: string | null;
  yearly: SeedActionStatus | 'n_a';
}

export interface SeedTopupResult {
  packId: TopupPack['id'];
  productId: string;
  priceId: string;
  product: SeedActionStatus;
  price: SeedActionStatus;
}

export interface SeedResult {
  plans: SeedPlanResult[];
  topups: SeedTopupResult[];
}

export interface SubscriptionPackagePriceSummary {
  id: string;
  interval: string | null;
  unitAmount: number | null;
  currency: string;
  metadata: Record<string, string>;
}

export interface SubscriptionPackageSummary {
  planId: string;
  name: string;
  productId: string;
  active: boolean;
  metadata: Record<string, string>;
  prices: SubscriptionPackagePriceSummary[];
}

/**
 * Idempotent seed for Stripe Products/Prices used by the credit system.
 *
 * Two families of objects are written:
 *   1. Subscription plans (free, starter, builder, pro, elite) — one
 *      monthly price + one yearly price each. Product metadata carries
 *      `plan_id` and the unified `credits` value so the webhook can
 *      grant the right amount without looking up this file.
 *   2. One-off top-up packs (topup_small/medium/large) — single `payment`
 *      mode Prices tagged `credit_topup=true` + `topup_pack=<id>`.
 *
 * Safe to re-run. Every write is gated by a `metadata` search so we
 * never duplicate products or prices.
 */
@Injectable()
export class StripeSeedService {
  private readonly logger = new Logger(StripeSeedService.name);

  constructor(private readonly stripeService: StripeService) {}

  async seed(): Promise<SeedResult> {
    const stripe = this.stripeService.getClient();
    const plans: SeedPlanResult[] = [];

    for (const plan of PLANS) {
      const { product, productStatus } = await this.findOrCreateProduct(
        stripe,
        plan,
      );

      const monthly = await this.ensureMonthlyPrice(stripe, product.id, plan);
      let yearly: { priceId: string | null; status: SeedActionStatus | 'n_a' } =
        { priceId: null, status: 'n_a' };
      if (plan.yearlyTotalCents > 0) {
        yearly = await this.ensureYearlyPrice(stripe, product.id, plan);
      }

      plans.push({
        planId: plan.id,
        planName: plan.name,
        productId: product.id,
        product: productStatus,
        monthlyPriceId: monthly.priceId,
        monthly: monthly.status,
        yearlyPriceId: yearly.priceId,
        yearly: yearly.status,
      });
    }

    const topups: SeedTopupResult[] = [];
    for (const pack of TOPUP_PACKS) {
      topups.push(await this.ensureTopupPack(stripe, pack));
    }

    this.logger.log('Stripe seed complete');
    return { plans, topups };
  }

  async listSubscriptionPackages(): Promise<SubscriptionPackageSummary[]> {
    const stripe = this.stripeService.getClient();
    const out: SubscriptionPackageSummary[] = [];

    for (const plan of PLANS) {
      const existing = await stripe.products.search({
        query: `metadata["plan_id"]:"${plan.id}"`,
      });

      if (existing.data.length === 0) continue;

      const product = existing.data[0];
      const priceList = await stripe.prices.list({
        product: product.id,
        active: true,
        limit: 100,
      });

      const prices: SubscriptionPackagePriceSummary[] = priceList.data.map(
        (p) => ({
          id: p.id,
          interval: p.recurring?.interval ?? null,
          unitAmount: p.unit_amount,
          currency: p.currency,
          metadata: p.metadata as Record<string, string>,
        }),
      );

      out.push({
        planId: plan.id,
        name: product.name,
        productId: product.id,
        active: product.active,
        metadata: product.metadata as Record<string, string>,
        prices,
      });
    }

    return out;
  }

  private async findOrCreateProduct(
    stripe: Stripe,
    plan: PlanDefinition,
  ): Promise<{ product: Stripe.Product; productStatus: SeedActionStatus }> {
    const existing = await stripe.products.search({
      query: `metadata["plan_id"]:"${plan.id}"`,
    });

    if (existing.data.length > 0) {
      const product = existing.data[0];
      // Keep metadata in sync with the canonical plan table on every seed
      // run — in particular `credits`, which might change as we recalibrate.
      await stripe.products.update(product.id, {
        metadata: {
          plan_id: plan.id,
          credits: String(plan.credits),
        },
      });
      this.logger.log(
        `Product "${plan.name}" already exists — metadata synced`,
      );
      return { product, productStatus: 'skipped' };
    }

    const product = await stripe.products.create({
      name: plan.name,
      description: plan.description,
      metadata: {
        plan_id: plan.id,
        credits: String(plan.credits),
      },
    });

    this.logger.log(`Created product "${plan.name}" (${product.id})`);
    return { product, productStatus: 'created' };
  }

  private async ensureMonthlyPrice(
    stripe: Stripe,
    productId: string,
    plan: PlanDefinition,
  ): Promise<{ priceId: string | null; status: SeedActionStatus | 'n_a' }> {
    const tag = `${plan.id}_monthly`;
    const existing = await this.findPriceByTag(stripe, tag);
    if (existing) {
      this.logger.log(`Monthly price for "${plan.name}" already exists`);
      return { priceId: existing.id, status: 'skipped' };
    }

    const price = await stripe.prices.create({
      product: productId,
      currency: 'eur',
      unit_amount: plan.monthlyPriceCents,
      recurring: { interval: 'month' },
      metadata: {
        price_tag: tag,
        plan_id: plan.id,
        credits: String(plan.credits),
        billing_cycle: 'monthly',
      },
      ...(plan.monthlyPriceCents === 0 && {
        billing_scheme: 'per_unit' as const,
      }),
    });

    this.logger.log(
      `Created monthly price for "${plan.name}" — ${price.id} (€${(plan.monthlyPriceCents / 100).toFixed(2)}/mo)`,
    );
    return { priceId: price.id, status: 'created' };
  }

  private async ensureYearlyPrice(
    stripe: Stripe,
    productId: string,
    plan: PlanDefinition,
  ): Promise<{ priceId: string | null; status: SeedActionStatus | 'n_a' }> {
    const tag = `${plan.id}_yearly`;
    const existing = await this.findPriceByTag(stripe, tag);
    if (existing) {
      this.logger.log(`Yearly price for "${plan.name}" already exists`);
      return { priceId: existing.id, status: 'skipped' };
    }

    const price = await stripe.prices.create({
      product: productId,
      currency: 'eur',
      unit_amount: plan.yearlyTotalCents,
      recurring: { interval: 'year' },
      metadata: {
        price_tag: tag,
        plan_id: plan.id,
        credits: String(plan.credits * 12),
        billing_cycle: 'yearly',
      },
    });

    this.logger.log(
      `Created yearly price for "${plan.name}" — ${price.id} (€${(plan.yearlyTotalCents / 100).toFixed(2)}/yr)`,
    );
    return { priceId: price.id, status: 'created' };
  }

  private async ensureTopupPack(
    stripe: Stripe,
    pack: TopupPack,
  ): Promise<SeedTopupResult> {
    const existingProducts = await stripe.products.search({
      query: `metadata["topup_pack"]:"${pack.id}"`,
    });

    let product: Stripe.Product;
    let productStatus: SeedActionStatus;
    if (existingProducts.data.length > 0) {
      product = existingProducts.data[0];
      productStatus = 'skipped';
    } else {
      product = await stripe.products.create({
        name: `Credits — ${pack.name}`,
        description: `${pack.credits} Iyona credits (one-off top-up).`,
        metadata: {
          credit_topup: 'true',
          topup_pack: pack.id,
          credits: String(pack.credits),
        },
      });
      productStatus = 'created';
      this.logger.log(`Created topup product "${pack.id}" (${product.id})`);
    }

    const priceTag = `topup_${pack.id}`;
    const existingPrice = await this.findPriceByTag(stripe, priceTag);

    let priceId: string;
    let priceStatus: SeedActionStatus;
    if (existingPrice) {
      priceId = existingPrice.id;
      priceStatus = 'skipped';
    } else {
      const price = await stripe.prices.create({
        product: product.id,
        currency: 'eur',
        unit_amount: pack.priceCents,
        metadata: {
          price_tag: priceTag,
          credit_topup: 'true',
          topup_pack: pack.id,
          credits: String(pack.credits),
        },
      });
      priceId = price.id;
      priceStatus = 'created';
      this.logger.log(
        `Created topup price for "${pack.id}" — ${price.id} (€${(pack.priceCents / 100).toFixed(2)})`,
      );
    }

    return {
      packId: pack.id,
      productId: product.id,
      priceId,
      product: productStatus,
      price: priceStatus,
    };
  }

  private async findPriceByTag(
    stripe: Stripe,
    tag: string,
  ): Promise<Stripe.Price | undefined> {
    const results = await stripe.prices.search({
      query: `metadata["price_tag"]:"${tag}"`,
    });
    return results.data[0];
  }
}
