import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
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
@ApiTags('admin-cursor')
@ApiBearerAuth('JWT-auth')
@Controller('admin/cursor')
@UseGuards(AuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminCursorController {
  constructor(private readonly cursor: CursorService) {}

  @Get('models')
  @ApiOperation({
    summary: 'Model ids the Cursor coding agent accepts',
    description:
      'Source for the coding-model picker in admin settings. These are ' +
      "Cursor's own ids — the model catalogue drives planning, Cursor writes " +
      'the code, and the two namespaces are not interchangeable. Returns an ' +
      'empty list if Cursor is unreachable.',
  })
  async models() {
    const data = await this.cursor.listAgentModels();
    return { data };
  }
}
