/**
 * E9 — per-seat plans for organizations.
 *
 * These are distinct from the legacy per-user `PlanId` enum in
 * `credits/constants/plans.ts`; team plans are billed per active org member
 * via Stripe `quantity` (one Subscription line item, quantity = seatCount).
 */

export type OrgPlanId = 'free' | 'team_starter' | 'team_pro';

export interface OrgPlanDefinition {
  id: OrgPlanId;
  name: string;
  description: string;
  /** Per-seat per-month price in cents. */
  pricePerSeatMonthlyCents: number;
  /** Per-seat per-month credit grant (added to org pool on each invoice.paid). */
  creditsPerSeatMonthly: number;
  /** Hard cap on seats; null = unlimited. Useful for sales-led plans. */
  seatCap: number | null;
}

export const ORG_PLANS: OrgPlanDefinition[] = [
  {
    id: 'free',
    name: 'Free',
    description: 'Solo workspace with the personal credit pool.',
    pricePerSeatMonthlyCents: 0,
    creditsPerSeatMonthly: 0,
    seatCap: 3,
  },
  {
    id: 'team_starter',
    name: 'Team Starter',
    description:
      'Shared workspace with per-seat credits, role-based access, and audit log.',
    pricePerSeatMonthlyCents: 2900,
    creditsPerSeatMonthly: 250,
    seatCap: 10,
  },
  {
    id: 'team_pro',
    name: 'Team Pro',
    description:
      'Higher per-seat credit grant, SSO, public API, webhooks, and priority support.',
    pricePerSeatMonthlyCents: 5900,
    creditsPerSeatMonthly: 600,
    seatCap: null,
  },
];

export const ORG_PLAN_BY_ID: Record<OrgPlanId, OrgPlanDefinition> =
  ORG_PLANS.reduce(
    (acc, p) => {
      acc[p.id] = p;
      return acc;
    },
    {} as Record<OrgPlanId, OrgPlanDefinition>,
  );

export function getOrgPlan(id: string | null | undefined): OrgPlanDefinition {
  if (id && (id as OrgPlanId) in ORG_PLAN_BY_ID) {
    return ORG_PLAN_BY_ID[id as OrgPlanId];
  }
  return ORG_PLAN_BY_ID.free;
}
