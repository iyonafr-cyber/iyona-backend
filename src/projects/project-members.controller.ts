import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from 'src/auth/guards/auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorator/roles.decorator';
import { UserRole } from 'src/user/roles/roles.enum';
import {
  CurrentUser,
  CurrentUserPayload,
} from 'src/auth/decorator/current-user.decorator';
import { ProjectMembersService } from './project-members.service';
import { InviteProjectMemberDto } from './dto/invite-project-member.dto';
import { ProjectMemberRowDto } from './dto/project-member-row.dto';

@ApiTags('Project Members')
@ApiBearerAuth('JWT-auth')
@UseGuards(AuthGuard, RolesGuard)
@Roles(UserRole.USER)
@Controller('projects')
export class ProjectMembersController {
  constructor(private readonly members: ProjectMembersService) {}

  @ApiOperation({ summary: 'List projects shared with the current user' })
  @Get('shared-with-me')
  async sharedWithMe(
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ data: Array<{ project: unknown; accessRole: string }> }> {
    const rows = await this.members.sharedWithMe(user.userId);
    return { data: rows };
  }

  @ApiOperation({ summary: 'List owner + members of a project' })
  @Get(':id/members')
  async list(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ data: ProjectMemberRowDto[] }> {
    const rows = await this.members.list(id, user.userId);
    return { data: rows };
  }

  @ApiOperation({ summary: 'Invite a registered user to a project' })
  @Post(':id/members/invite')
  async invite(
    @Param('id') id: string,
    @Body() dto: InviteProjectMemberDto,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ data: ProjectMemberRowDto }> {
    const row = await this.members.invite(id, dto, user.userId);
    return { data: row };
  }

  @ApiOperation({ summary: 'Remove a member from a project' })
  @Delete(':id/members/:memberId')
  async remove(
    @Param('id') id: string,
    @Param('memberId') memberId: string,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ message: string }> {
    await this.members.remove(id, memberId, user.userId);
    return { message: 'Member removed' };
  }
}
