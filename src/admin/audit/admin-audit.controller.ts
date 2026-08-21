import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '../../auth/guards/auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorator/roles.decorator';
import { UserRole } from '../../user/roles/roles.enum';
import { AuditLogService, AuditQueryFilters } from './audit-log.service';

@ApiTags('admin-audit')
@ApiBearerAuth('JWT-auth')
@Controller('admin/audit')
@UseGuards(AuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminAuditController {
  constructor(private readonly audit: AuditLogService) {}

  @Get()
  @ApiOperation({ summary: 'Query the admin audit log' })
  async list(
    @Query('actorId') actorId?: string,
    @Query('action') action?: string,
    @Query('targetType') targetType?: string,
    @Query('targetId') targetId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const filters: AuditQueryFilters = {
      actorId,
      action,
      targetType: targetType as AuditQueryFilters['targetType'],
      targetId,
      from,
      to,
      page: Number(page) || undefined,
      pageSize: Number(pageSize) || undefined,
    };
    const data = await this.audit.query(filters);
    return { data };
  }
}
