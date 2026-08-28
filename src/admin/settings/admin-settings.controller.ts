import { Body, Controller, Get, Patch, Req, UseGuards } from '@nestjs/common';
import {
  IsBoolean,
  IsObject,
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

  /**
   * Cursor model params ({effort: 'high', fast: 'true'}…) — ids/values come
   * from Cursor's live catalogue rendered in the dashboard; the service layer
   * sanitizes entries. null clears them.
   */
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsObject()
  cursorAgentModelParams?: Record<string, string> | null;
}

@Controller('admin/settings')
@UseGuards(AuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminSettingsController {
  constructor(private readonly settings: AdminSettingsService) {}

  @Get()
  async get() {
    const data = await this.settings.get();
    return { data };
  }

  @Patch()
  async patch(@Body() dto: PatchAdminSettingsDto, @Req() req: AdminRequest) {
    const actor = AuditLogService.actorFromRequest(req);
    const data = await this.settings.update(dto, actor);
    return { data };
  }
}

/**
 * Public companion endpoint: iyona-front hits this to know whether to show
 * a maintenance banner. Kept on a separate controller (no guard) so it
 * stays reachable when admins want to ship a "we're down" message.
 */
@Controller('system')
export class SystemStatusController {
  constructor(private readonly settings: AdminSettingsService) {}

  @Get('status')
  async status() {
    const data = await this.settings.publicStatus();
    return { data };
  }
}
