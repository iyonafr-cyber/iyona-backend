import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/guards/auth.guard';
import {
  CurrentUser,
  CurrentUserPayload,
} from '../auth/decorator/current-user.decorator';
import { OrgBillingService } from './org-billing.service';
import { ORG_PLANS } from './constants/org-plans';
import { IsIn, IsOptional, IsString, IsUrl } from 'class-validator';
class TeamCheckoutDto {
  @IsString()
  @IsIn(['team_starter', 'team_pro'])
  planId!: 'team_starter' | 'team_pro';

  @IsOptional()
  @IsUrl({ require_protocol: true })
  successUrl?: string;

  @IsOptional()
  @IsUrl({ require_protocol: true })
  cancelUrl?: string;
}

class TeamPortalDto {
  @IsOptional()
  @IsUrl({ require_protocol: true })
  returnUrl?: string;
}

@UseGuards(AuthGuard)
@Controller('organizations/:orgId/billing')
export class OrgBillingController {
  constructor(private readonly billing: OrgBillingService) {}

  @Get('plans')
  listPlans() {
    return { data: ORG_PLANS };
  }

  @Get()
  async get(
    @Param('orgId') orgId: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    const data = await this.billing.getOrgBilling(orgId, user.userId);
    return { data };
  }

  @Post('checkout')
  async checkout(
    @Param('orgId') orgId: string,
    @Body() dto: TeamCheckoutDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    const data = await this.billing.createCheckout({
      orgId,
      userId: user.userId,
      planId: dto.planId,
      successUrl: dto.successUrl,
      cancelUrl: dto.cancelUrl,
    });
    return { data };
  }

  @Post('portal')
  async portal(
    @Param('orgId') orgId: string,
    @Body() dto: TeamPortalDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    const data = await this.billing.createPortalSession(
      orgId,
      user.userId,
      dto.returnUrl,
    );
    return { data };
  }
}
