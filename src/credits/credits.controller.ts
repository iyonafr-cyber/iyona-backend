import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../auth/guards/auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorator/roles.decorator';
import { UserRole } from '../user/roles/roles.enum';
import { CreditsService } from './credits.service';
import { CreditsTopupService } from './credits-topup.service';
import { CreditsSubscriptionService } from './credits-subscription.service';
import { TopupCheckoutDto } from './dto/topup-checkout.dto';
import { PlanCheckoutDto, PortalSessionDto } from './dto/plan-checkout.dto';
import { CREDIT_ACTIONS, CreditActionKey } from './constants/credit-actions';
import { PLANS, TOPUP_PACKS, getPlan } from './constants/plans';
import { AuthedRequest } from './types/authed-request';

@Controller('credits')
export class CreditsController {
  constructor(
    private readonly creditsService: CreditsService,
    private readonly topupService: CreditsTopupService,
    private readonly subscriptionService: CreditsSubscriptionService,
  ) {}

  @Get('signup-offer')
  getSignupOffer() {
    const bonusCredits = this.creditsService.getSignupBonusCreditsOffer();
    return { data: { bonusCredits } };
  }

  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.USER, UserRole.ADMIN)
  @Get('balance')
  async getBalance(@Req() req: AuthedRequest) {
    const userId = String(req.fullUser._id);
    const balance = await this.creditsService.getBalance(userId);
    return { data: balance };
  }

  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.USER, UserRole.ADMIN)
  @Get('usage')
  async listUsage(@Req() req: AuthedRequest, @Query('limit') limit?: string) {
    const userId = String(req.fullUser._id);
    const parsedLimit = Number(limit) > 0 ? Number(limit) : 50;
    const rows = await this.creditsService.listUsage(userId, parsedLimit);

    // Redact provider-specific fields so the UI never sees tokens, models,
    // or raw USD cost. Research doc §8 — users should only see credits.
    const safe = rows.map((r) => ({
      id: String(r._id),
      action: r.action,
      projectId: r.projectId,
      creditsCharged: r.creditsCharged,
      status: r.status,
      createdAt: (r as { createdAt?: Date }).createdAt,
    }));
    return { data: safe };
  }

  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.USER, UserRole.ADMIN)
  @Get('plan')
  async getPlan(@Req() req: AuthedRequest) {
    const balance = await this.creditsService.getBalance(
      String(req.fullUser._id),
    );
    const current = getPlan(balance.planId);

    return {
      data: {
        current: {
          id: current.id,
          name: current.name,
          credits: current.credits,
          creditsRenewAt: balance.creditsRenewAt,
        },
        plans: PLANS.map((p) => ({
          id: p.id,
          name: p.name,
          description: p.description,
          monthlyPriceCents: p.monthlyPriceCents,
          yearlyTotalCents: p.yearlyTotalCents,
          credits: p.credits,
        })),
        topupPacks: TOPUP_PACKS,
        actions: (Object.keys(CREDIT_ACTIONS) as CreditActionKey[]).map(
          (k) => ({
            key: k,
            displayCredits: CREDIT_ACTIONS[k].displayCredits,
          }),
        ),
      },
    };
  }

  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.USER, UserRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  @Post('topup/checkout')
  async createTopupCheckout(
    @Req() req: AuthedRequest,
    @Body() dto: TopupCheckoutDto,
  ) {
    const userId = String(req.fullUser._id);
    const data = await this.topupService.createCheckout({
      userId,
      pack: dto.pack,
      successUrl: dto.successUrl,
      cancelUrl: dto.cancelUrl,
    });
    return { data };
  }

  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.USER, UserRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  @Post('plan/checkout')
  async createPlanCheckout(
    @Req() req: AuthedRequest,
    @Body() dto: PlanCheckoutDto,
  ) {
    const userId = String(req.fullUser._id);
    const data = await this.subscriptionService.createPlanCheckout({
      userId,
      planId: dto.planId,
      cycle: dto.cycle,
      successUrl: dto.successUrl,
      cancelUrl: dto.cancelUrl,
    });
    return { data };
  }

  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.USER, UserRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  @Post('portal')
  async createPortalSession(
    @Req() req: AuthedRequest,
    @Body() dto: PortalSessionDto,
  ) {
    const userId = String(req.fullUser._id);
    const data = await this.subscriptionService.createPortalSession({
      userId,
      returnUrl: dto.returnUrl,
    });
    return { data };
  }

  // ──────────────────────────────────────────────────────────────
  // Admin endpoints
  // ──────────────────────────────────────────────────────────────

  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Get('admin/margin')
  async adminMargin(@Query('days') days?: string) {
    const window = Number(days) > 0 ? Math.min(Number(days), 90) : 30;
    const data = await this.creditsService.aggregateMargin({ days: window });
    return { data };
  }

  // NOTE: the old `POST /credits/admin/adjust` route was removed because it
  // bypassed AuditLogService. All admin balance adjustments must now go
  // through `POST /admin/credits/adjust` (see AdminCreditsController), which
  // delegates to `CreditsService.adminAdjust` AND writes an audit row.
}
