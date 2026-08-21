import { Body, Controller, Get, Patch, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { AuthGuard } from '../../auth/guards/auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorator/roles.decorator';
import { UserRole } from '../../user/roles/roles.enum';
import { AdminRequest, AuditLogService } from '../audit/audit-log.service';
import { AdminSettingsService } from './admin-settings.service';

export class PatchAdminSettingsDto {
  @IsOptional()
  @IsBoolean()
  maintenanceMode?: boolean;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(500)
  maintenanceMessage?: string | null;

  /** Cursor model id for code authorship. null/'' resets to the env default. */
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(120)
  cursorAgentModelId?: string | null;
}

@ApiTags('admin-settings')
@ApiBearerAuth('JWT-auth')
@Controller('admin/settings')
@UseGuards(AuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminSettingsController {
  constructor(private readonly settings: AdminSettingsService) {}

  @Get()
  @ApiOperation({ summary: 'Read admin settings singleton' })
  async get() {
    const data = await this.settings.get();
    return { data };
  }

  @Patch()
  @ApiOperation({ summary: 'Update admin settings (audited)' })
  async patch(@Body() dto: PatchAdminSettingsDto, @Req() req: AdminRequest) {
    const actor = AuditLogService.actorFromRequest(req);
    const data = await this.settings.update(dto, actor);
    return { data };
  }
}

/**
 * Public companion endpoint: jarvis-front hits this to know whether to show
 * a maintenance banner. Kept on a separate controller (no guard) so it
 * stays reachable when admins want to ship a "we're down" message.
 */
@ApiTags('system')
@Controller('system')
export class SystemStatusController {
  constructor(private readonly settings: AdminSettingsService) {}

  @Get('status')
  @ApiOperation({ summary: 'Public maintenance status' })
  async status() {
    const data = await this.settings.publicStatus();
    return { data };
  }
}
