import { Controller, Get, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/guards/auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorator/roles.decorator';
import { UserRole } from '../user/roles/roles.enum';
import { CursorService } from './cursor.service';

/**
 * Lives in CursorModule rather than under admin/settings on purpose:
 * CursorModule already imports AdminSettingsModule to read the configured
 * coding model, so hanging this off the settings controller would close a
 * dependency cycle.
 */
@Controller('admin/cursor')
@UseGuards(AuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminCursorController {
  constructor(private readonly cursor: CursorService) {}

  /**
   * The full live catalogue — model ids, display names, and each model's
   * parameters (effort/reasoning/thinking/fast) with permitted values — so the
   * dashboard renders model AND effort pickers from current Cursor data
   * instead of a hardcoded list. Flat string[] remains available to older
   * clients via the same payload's `id` fields.
   */
  @Get('models')
  async models() {
    const data = await this.cursor.listAgentModelCatalog();
    return { data };
  }
}
