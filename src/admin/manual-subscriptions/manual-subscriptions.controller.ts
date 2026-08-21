import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiProperty,
  ApiTags,
} from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { AuthGuard } from '../../auth/guards/auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorator/roles.decorator';
import { UserRole } from '../../user/roles/roles.enum';
import { PLANS, PlanId } from '../../credits/constants/plans';
import { AdminRequest, AuditLogService } from '../audit/audit-log.service';
import { ManualSubscriptionsService } from './manual-subscriptions.service';

// Plans available for manual grants — explicitly excludes 'free' since
// granting a free plan manually is meaningless.
const GRANTABLE_PLAN_IDS = PLANS.map((p) => p.id).filter(
  (id): id is Exclude<PlanId, 'free'> => id !== 'free',
);

// Whitelist of currencies the admin form supports today. Add as needed —
// kept short on purpose so admins don't typo arbitrary codes.
const ALLOWED_CURRENCIES = ['USD', 'EUR', 'GBP', 'PKR', 'CAD', 'AUD'] as const;

export class GrantManualSubDto {
  @ApiProperty({
    enum: GRANTABLE_PLAN_IDS as unknown as string[],
    description: 'Plan to assign. Must not be "free".',
  })
  @IsIn(GRANTABLE_PLAN_IDS as unknown as string[])
  planId: Exclude<PlanId, 'free'>;

  @ApiProperty({
    example: 3,
    minimum: 1,
    maximum: 36,
    description:
      'Number of months the manual subscription should remain active.',
  })
  @IsInt()
  @Min(1)
  @Max(36)
  months: number;

  @ApiProperty({
    example: 4900,
    minimum: 0,
    description:
      'Amount the user paid, in minor units (cents). Stored for tracking only.',
  })
  @IsInt()
  @Min(0)
  amountPaidCents: number;

  @ApiProperty({
    required: false,
    enum: ALLOWED_CURRENCIES as unknown as string[],
    default: 'USD',
    description: 'ISO-4217 currency code for amountPaidCents.',
  })
  @IsOptional()
  @IsIn(ALLOWED_CURRENCIES as unknown as string[])
  currency?: string;

  @ApiProperty({
    required: false,
    maxLength: 500,
    description:
      'Free-form note for record-keeping (e.g. "Cash payment from John on 2026-04-18").',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  @ApiProperty({
    required: false,
    default: false,
    description:
      'If the user has an active Stripe subscription, set this to true to acknowledge ' +
      'the double-billing risk and proceed anyway. The Stripe sub is NOT cancelled by this flag.',
  })
  @IsOptional()
  @IsBoolean()
  overrideStripe?: boolean;
}

export class RevokeManualSubDto {
  @ApiProperty({
    required: false,
    maxLength: 500,
    description: 'Optional reason for the audit trail.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

@ApiTags('admin-manual-subscriptions')
@ApiBearerAuth('JWT-auth')
@Controller('admin/users/:id/manual-subscription')
@UseGuards(AuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class ManualSubscriptionsController {
  constructor(
    private readonly manualSubs: ManualSubscriptionsService,
    private readonly audit: AuditLogService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Grant a manual (admin-issued) subscription for N months',
  })
  async grant(
    @Param('id') id: string,
    @Body() dto: GrantManualSubDto,
    @Req() req: AdminRequest,
  ) {
    const actor = AuditLogService.actorFromRequest(req);
    const summary = await this.manualSubs.grant(
      id,
      {
        planId: dto.planId,
        months: dto.months,
        amountPaidCents: dto.amountPaidCents,
        currency: dto.currency ?? 'USD',
        note: dto.note,
        overrideStripe: dto.overrideStripe,
      },
      actor.actorId,
    );

    await this.audit.log(actor, {
      action: 'user.manual_subscription.granted',
      targetType: 'user',
      targetId: id,
      after: {
        planId: summary.planId,
        months: summary.months,
        amountPaidCents: summary.amountPaidCents,
        currency: summary.currency,
        expiresAt: summary.expiresAt,
        overrideStripe: !!dto.overrideStripe,
      },
      reason: dto.note ?? null,
    });

    return { data: summary };
  }

  @Delete()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Revoke an active manual subscription immediately (drops user to free)',
  })
  async revoke(
    @Param('id') id: string,
    @Body() dto: RevokeManualSubDto,
    @Req() req: AdminRequest,
  ) {
    const actor = AuditLogService.actorFromRequest(req);
    await this.manualSubs.revoke(id, actor.actorId, 'admin_revoked');

    await this.audit.log(actor, {
      action: 'user.manual_subscription.revoked',
      targetType: 'user',
      targetId: id,
      reason: dto.reason ?? null,
    });

    return { data: { ok: true } };
  }
}
