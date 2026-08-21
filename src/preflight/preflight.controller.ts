import { Controller, Get, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/guards/auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorator/roles.decorator';
import { UserRole } from '../user/roles/roles.enum';
import {
  CurrentUser,
  CurrentUserPayload,
} from '../auth/decorator/current-user.decorator';
import { PreflightService } from './preflight.service';
import type { PreflightResult } from './preflight.types';

@UseGuards(AuthGuard, RolesGuard)
@Roles(UserRole.USER)
@Controller('preflight')
export class PreflightController {
  constructor(private readonly preflight: PreflightService) {}

  @Get('build')
  async build(
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ data: PreflightResult }> {
    return { data: await this.preflight.checkBuildReadiness(user.userId) };
  }
}
