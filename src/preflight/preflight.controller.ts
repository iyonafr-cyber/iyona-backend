import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
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

@ApiTags('Preflight')
@ApiBearerAuth('JWT-auth')
@UseGuards(AuthGuard, RolesGuard)
@Roles(UserRole.USER)
@Controller('preflight')
export class PreflightController {
  constructor(private readonly preflight: PreflightService) {}

  @Get('build')
  @ApiOperation({
    summary: 'Check every upstream a build depends on before starting one',
    description:
      'Probes the Cursor agent, the LLM provider, GitHub, Vercel, and the ' +
      "caller's credit balance. The client must not open a project chat " +
      'when `ready` is false — the point is to fail at the door rather ' +
      'than halfway through a build.',
  })
  async build(
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ data: PreflightResult }> {
    return { data: await this.preflight.checkBuildReadiness(user.userId) };
  }
}
