/**
 * Canonical plan definitions for the credit system.
 *
 * Plans map a Stripe product to a monthly credit quota. The Stripe seed
 * (see `stripe-seed.service.ts`) publishes the same identifiers to the
 * Stripe product metadata so the webhook can translate a price_id back to
 * a credit grant without a second database lookup.
 */

export type PlanId = 'elite' | 'pro' | 'builder' | 'starter' | 'free';

export interface PlanDefinition {
  id: PlanId;
  name: string;
  description: string;
  monthlyPriceCents: number;
  yearlyTotalCents: number;
  credits: number;
}

export const PLANS: PlanDefinition[] = [
  {
    id: 'elite',
    name: 'Elite',
    description:
      'Scale your app effortlessly with top credits and dedicated support.',
    monthlyPriceCents: 12999,
    yearlyTotalCents: 131988,
    credits: 1700,
  },
  {
    id: 'pro',
    name: 'Pro',
    description:
      'Access advanced tools and support for developing complex applications.',
    monthlyPriceCents: 6999,
    yearlyTotalCents: 67188,
    credits: 700,
  },
  {
    id: 'builder',
    name: 'Builder',
    description:
      'Take your idea to the next level with tools to meet your professional needs.',
    monthlyPriceCents: 2999,
    yearlyTotalCents: 31188,
    credits: 350,
  },
  {
    id: 'starter',
    name: 'Starter',
    description:
      'Build out your first apps for personal projects or early-stage ideas.',
    monthlyPriceCents: 1999,
    yearlyTotalCents: 19188,
    credits: 120,
  },
  {
    id: 'free',
    name: 'Free',
    description:
      'Access all of Jarvis core features at no cost and see what it can do.',
    monthlyPriceCents: 0,
    yearlyTotalCents: 0,
    credits: 100,
  },
];

export const PLAN_BY_ID: Record<PlanId, PlanDefinition> = PLANS.reduce(
  (acc, plan) => {
    acc[plan.id] = plan;
    return acc;
  },
  {} as Record<PlanId, PlanDefinition>,
);

export function getPlan(planId: string | null | undefined): PlanDefinition {
  if (planId && planId in PLAN_BY_ID) {
    return PLAN_BY_ID[planId as PlanId];
  }
  return PLAN_BY_ID.free;
}

/**
 * One-off top-up packs. These are distinct from plans: they never reset, they
 * stack on top of the monthly quota, and they're always purchased via a
 * one-time Stripe checkout.
 */
export interface TopupPack {
  id: 'topup_small' | 'topup_medium' | 'topup_large';
  name: string;
  credits: number;
  priceCents: number;
}

export const TOPUP_PACKS: TopupPack[] = [
  {
    id: 'topup_small',
    name: '100 credits',
    credits: 100,
    priceCents: 500,
  },
  {
    id: 'topup_medium',
    name: '500 credits',
    credits: 500,
    priceCents: 2000,
  },
  {
    id: 'topup_large',
    name: '2000 credits',
    credits: 2000,
    priceCents: 7000,
  },
];

export const TOPUP_BY_ID: Record<TopupPack['id'], TopupPack> =
  TOPUP_PACKS.reduce(
    (acc, t) => {
      acc[t.id] = t;
      return acc;
    },
    {} as Record<TopupPack['id'], TopupPack>,
  );
