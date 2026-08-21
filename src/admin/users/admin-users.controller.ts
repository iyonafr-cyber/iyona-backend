import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { AuthGuard } from '../../auth/guards/auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorator/roles.decorator';
import { UserRole } from '../../user/roles/roles.enum';
import { AdminRequest, AuditLogService } from '../audit/audit-log.service';
import { AdminUsersService } from './admin-users.service';

export class PatchAdminUserDto {
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;

  @IsOptional()
  @IsString()
  planId?: string;

  @IsOptional()
  @IsBoolean()
  isVerified?: boolean;

  @IsOptional()
  @IsBoolean()
  isDeleted?: boolean;

  @IsOptional()
  @IsBoolean()
  isSuspended?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

@Controller('admin/users')
@UseGuards(AuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminUsersController {
  constructor(private readonly adminUsers: AdminUsersService) {}

  @Get()
  async list(
    @Query('q') q?: string,
    @Query('role') role?: UserRole,
    @Query('planId') planId?: string,
    @Query('isVerified') isVerified?: string,
    @Query('isDeleted') isDeleted?: string,
    @Query('isSuspended') isSuspended?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('sort') sort?: string,
  ) {
    const data = await this.adminUsers.list({
      q,
      role,
      planId,
      isVerified,
      isDeleted,
      isSuspended,
      from,
      to,
      page: Number(page) || undefined,
      pageSize: Number(pageSize) || undefined,
      sort,
    });
    return { data };
  }

  @Get(':id')
  async detail(@Param('id') id: string) {
    const data = await this.adminUsers.detail(id);
    return { data };
  }

  @Patch(':id')
  async patch(
    @Param('id') id: string,
    @Body() dto: PatchAdminUserDto,
    @Req() req: AdminRequest,
  ) {
    const actor = AuditLogService.actorFromRequest(req);
    const data = await this.adminUsers.patch(id, dto, actor);
    return { data };
  }

  @Post(':id/force-logout')
  @HttpCode(HttpStatus.OK)
  async forceLogout(@Param('id') id: string, @Req() req: AdminRequest) {
    const actor = AuditLogService.actorFromRequest(req);
    await this.adminUsers.forceLogout(id, actor);
    return { data: { ok: true } };
  }

  @Post(':id/resend-verification')
  @HttpCode(HttpStatus.OK)
  async resendVerification(@Param('id') id: string, @Req() req: AdminRequest) {
    const actor = AuditLogService.actorFromRequest(req);
    const data = await this.adminUsers.resendVerification(id, actor);
    return { data };
  }
}
