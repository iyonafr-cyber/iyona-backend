import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '../auth/guards/auth.guard';
import {
  CurrentUser,
  CurrentUserPayload,
} from '../auth/decorator/current-user.decorator';
import { OrgBillingService } from './org-billing.service';
import { ORG_PLANS } from './constants/org-plans';
import { IsIn, IsOptional, IsString, IsUrl } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

class TeamCheckoutDto {
  @ApiProperty({ enum: ['team_starter', 'team_pro'] })
  @IsString()
  @IsIn(['team_starter', 'team_pro'])
  planId!: 'team_starter' | 'team_pro';

  @ApiPropertyOptional()
  @IsOptional()
  @IsUrl({ require_protocol: true })
  successUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUrl({ require_protocol: true })
  cancelUrl?: string;
}

class TeamPortalDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUrl({ require_protocol: true })
  returnUrl?: string;
}

@ApiTags('Org Billing (E9)')
@ApiBearerAuth('JWT-auth')
@UseGuards(AuthGuard)
@Controller('organizations/:orgId/billing')
export class OrgBillingController {
  constructor(private readonly billing: OrgBillingService) {}

  @ApiOperation({ summary: 'List available team plans.' })
  @Get('plans')
  listPlans() {
    return { data: ORG_PLANS };
  }

  @ApiOperation({ summary: 'Current org billing snapshot.' })
  @Get()
  async get(
    @Param('orgId') orgId: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    const data = await this.billing.getOrgBilling(orgId, user.userId);
    return { data };
  }

  @ApiOperation({ summary: 'Start a Stripe checkout for a team plan.' })
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

  @ApiOperation({ summary: 'Open the Stripe customer portal for this org.' })
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
