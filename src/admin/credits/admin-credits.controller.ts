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
import { AuthGuard } from '../../auth/guards/auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorator/roles.decorator';
import { UserRole } from '../../user/roles/roles.enum';
import { AdminAdjustDto } from '../../credits/dto/admin-adjust.dto';
import { CreditLedgerType } from '../../credits/entities/credit-ledger.entity';
import { AdminRequest, AuditLogService } from '../audit/audit-log.service';
import { AdminCreditsService } from './admin-credits.service';

@Controller('admin/credits')
@UseGuards(AuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminCreditsController {
  constructor(private readonly adminCredits: AdminCreditsService) {}

  @Get('ledger')
  async ledger(
    @Query('userId') userId?: string,
    @Query('type') type?: CreditLedgerType,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const data = await this.adminCredits.queryLedger({
      userId,
      type,
      from,
      to,
      page: Number(page) || undefined,
      pageSize: Number(pageSize) || undefined,
    });
    return { data };
  }

  @Get('top-spenders')
  async topSpenders(
    @Query('days') days?: string,
    @Query('limit') limit?: string,
  ) {
    const data = await this.adminCredits.topSpenders({
      days: Number(days) || 30,
      limit: Number(limit) || 10,
    });
    return { data };
  }

  @Post('adjust')
  @HttpCode(HttpStatus.OK)
  async adjust(
    @Body() dto: AdminAdjustDto,
    @Req() req: AdminRequest,
  ): Promise<{ data: unknown }> {
    const actor = AuditLogService.actorFromRequest(req);
    const data = await this.adminCredits.adjustWithAudit(
      {
        userId: dto.userId,
        amount: dto.amount,
        bucket: dto.bucket,
        reason: dto.reason,
      },
      actor,
    );
    return { data };
  }
}
