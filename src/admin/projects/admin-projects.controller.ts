import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';
import { AuthGuard } from '../../auth/guards/auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorator/roles.decorator';
import { UserRole } from '../../user/roles/roles.enum';
import { AdminRequest, AuditLogService } from '../audit/audit-log.service';
import { AdminProjectsService } from './admin-projects.service';

export class PatchAdminProjectDto {
  @IsOptional()
  @IsBoolean()
  takedown?: boolean;

  @IsOptional()
  @IsBoolean()
  locked?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  // E5 — admin can curate templates from any project. The `isPublic`
  // toggle here is also exposed so admins can publish a project on
  // behalf of an owner who can't (e.g. takedown-recovery flows).
  @IsOptional()
  @IsBoolean()
  isTemplate?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  templateCategory?: string;

  @IsOptional()
  @IsBoolean()
  isPublic?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class DeleteProjectDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

@ApiTags('admin-projects')
@ApiBearerAuth('JWT-auth')
@Controller('admin/projects')
@UseGuards(AuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminProjectsController {
  constructor(private readonly adminProjects: AdminProjectsService) {}

  @Get()
  @ApiOperation({ summary: 'List projects with owner joined' })
  async list(
    @Query('q') q?: string,
    @Query('ownerId') ownerId?: string,
    @Query('status') status?: string,
    @Query('stage') stage?: string,
    @Query('deleted') deleted?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const data = await this.adminProjects.list({
      q,
      ownerId,
      status,
      stage,
      deleted,
      page: Number(page) || undefined,
      pageSize: Number(pageSize) || undefined,
    });
    return { data };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Project detail with owner + counts' })
  async detail(@Param('id') id: string) {
    const data = await this.adminProjects.detail(id);
    return { data };
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Patch project (takedown, lock, name)' })
  async patch(
    @Param('id') id: string,
    @Body() dto: PatchAdminProjectDto,
    @Req() req: AdminRequest,
  ) {
    const actor = AuditLogService.actorFromRequest(req);
    const data = await this.adminProjects.patch(id, dto, actor);
    return { data };
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Soft-delete a project' })
  async delete(
    @Param('id') id: string,
    @Body() dto: DeleteProjectDto,
    @Req() req: AdminRequest,
  ) {
    const actor = AuditLogService.actorFromRequest(req);
    await this.adminProjects.softDelete(id, dto.reason, actor);
    return { data: { ok: true } };
  }
}
