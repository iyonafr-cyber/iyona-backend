import { IsIn, IsOptional, IsString } from 'class-validator';
import { PLANS, PlanId } from '../constants/plans';

const PAID_PLAN_IDS = PLANS.filter((p) => p.id !== 'free').map((p) => p.id);

export class PlanCheckoutDto {
  @IsString()
  @IsIn(PAID_PLAN_IDS)
  planId: Exclude<PlanId, 'free'>;

  @IsOptional()
  @IsString()
  @IsIn(['monthly', 'yearly'])
  cycle?: 'monthly' | 'yearly';

  @IsOptional()
  @IsString()
  successUrl?: string;

  @IsOptional()
  @IsString()
  cancelUrl?: string;
}

export class PortalSessionDto {
  @IsOptional()
  @IsString()
  returnUrl?: string;
}
