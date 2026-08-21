import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { plainToInstance } from 'class-transformer';

import { AuthGuard } from '../auth/guards/auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorator/roles.decorator';
import { UserRole } from '../user/roles/roles.enum';
import {
  CurrentUser,
  CurrentUserPayload,
} from '../auth/decorator/current-user.decorator';

import { OrganizationsService } from './organizations.service';
import {
  CreateOrganizationDto,
  InviteMemberDto,
  OrganizationDto,
  OrganizationListItemDto,
  OrgMemberDto,
  SwitchOrganizationDto,
  UpdateMemberRoleDto,
  UpdateOrganizationDto,
} from './dto/organization.dto';

@ApiTags('Organizations')
@ApiBearerAuth('JWT-auth')
@UseGuards(AuthGuard, RolesGuard)
@Roles(UserRole.USER)
@Controller('organizations')
export class OrganizationsController {
  constructor(private readonly orgService: OrganizationsService) {}

  @ApiOperation({
    summary: 'List organizations the caller belongs to (E8).',
    description:
      'On first call, lazily creates a personal workspace if the user has none.',
  })
  @ApiResponse({ status: 200, type: [OrganizationListItemDto] })
  @Get('mine')
  async listMine(
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ data: OrganizationListItemDto[]; activeOrgId: string | null }> {
    const orgs = await this.orgService.listMyOrgs(user.userId);
    const data = orgs.map((o) =>
      plainToInstance(
        OrganizationListItemDto,
        {
          _id: String((o as any)._id),
          name: o.name,
          slug: o.slug,
          ownerId: String(o.ownerId),
          isPersonal: o.isPersonal,
          plan: o.plan,
          featureFlags: o.featureFlags ?? [],
          seatCount: o.seatCount ?? 1,
          ssoConnectionId: o.ssoConnectionId ?? null,
          myRole: (o as any).myRole,
          memberCount: (o as any).memberCount ?? 1,
        },
        { excludeExtraneousValues: true },
      ),
    );
    // Trust the user's persisted currentOrgId so the switcher shows the
    // org they actually picked last; fall back to the first membership
    // for first-time callers (and clean up dangling pointers if the user
    // was removed from their previously-active org).
    const stored = await this.orgService.getActiveOrgId(user.userId);
    const validIds = new Set(data.map((d) => d._id));
    const active =
      stored && validIds.has(stored) ? stored : (data[0]?._id ?? null);
    return { data, activeOrgId: active };
  }

  @ApiOperation({ summary: 'Create a new organization (E8).' })
  @ApiResponse({ status: 201, type: OrganizationDto })
  @Post()
  async create(
    @Body() dto: CreateOrganizationDto,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ data: OrganizationDto }> {
    const org = await this.orgService.create(user.userId, dto);
    return { data: this.toDto(org) };
  }

  @ApiOperation({ summary: 'Update organization name/featureFlags (E8).' })
  @ApiResponse({ status: 200, type: OrganizationDto })
  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateOrganizationDto,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ data: OrganizationDto }> {
    const org = await this.orgService.update(id, user.userId, dto);
    return { data: this.toDto(org) };
  }

  @ApiOperation({ summary: 'Delete a non-personal organization (E8).' })
  @ApiResponse({ status: 204 })
  @Delete(':id')
  async remove(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ ok: true }> {
    await this.orgService.deleteOrg(id, user.userId);
    return { ok: true };
  }

  @ApiOperation({ summary: 'Switch the current active org (E8).' })
  @ApiResponse({ status: 200, type: OrganizationDto })
  @Put('switch')
  async switch(
    @Body() dto: SwitchOrganizationDto,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ data: OrganizationDto }> {
    const org = await this.orgService.switchOrg(user.userId, dto.orgId);
    return { data: this.toDto(org) };
  }

  // ── Members ────────────────────────────────────────────────────

  @ApiOperation({ summary: 'List members of an organization (E8).' })
  @ApiResponse({ status: 200, type: [OrgMemberDto] })
  @Get(':id/members')
  async listMembers(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ data: OrgMemberDto[] }> {
    const members = await this.orgService.listMembers(id, user.userId);
    return {
      data: members.map((m) =>
        plainToInstance(
          OrgMemberDto,
          {
            _id: String((m as any)._id),
            orgId: String(m.orgId),
            userId: String(m.userId),
            role: m.role,
            email: (m as any).email,
            lastActiveAt: m.lastActiveAt
              ? new Date(m.lastActiveAt).toISOString()
              : null,
          },
          { excludeExtraneousValues: true },
        ),
      ),
    };
  }

  @ApiOperation({ summary: 'Invite an existing user to the org (E8).' })
  @ApiResponse({ status: 201, type: OrgMemberDto })
  @Post(':id/members')
  async invite(
    @Param('id') id: string,
    @Body() dto: InviteMemberDto,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ data: OrgMemberDto }> {
    const m = await this.orgService.invite(id, user.userId, dto);
    return {
      data: plainToInstance(
        OrgMemberDto,
        {
          _id: String((m as any)._id),
          orgId: String(m.orgId),
          userId: String(m.userId),
          role: m.role,
        },
        { excludeExtraneousValues: true },
      ),
    };
  }

  @ApiOperation({ summary: 'Update a member role / transfer ownership (E8).' })
  @ApiResponse({ status: 200, type: OrgMemberDto })
  @Patch(':id/members/:userId')
  async updateRole(
    @Param('id') id: string,
    @Param('userId') targetUserId: string,
    @Body() dto: UpdateMemberRoleDto,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ data: OrgMemberDto }> {
    const m = await this.orgService.updateMemberRole(
      id,
      user.userId,
      targetUserId,
      dto,
    );
    return {
      data: plainToInstance(
        OrgMemberDto,
        {
          _id: String((m as any)._id),
          orgId: String(m.orgId),
          userId: String(m.userId),
          role: m.role,
        },
        { excludeExtraneousValues: true },
      ),
    };
  }

  @ApiOperation({
    summary: 'Remove a member (or leave the org if removing yourself) (E8).',
  })
  @ApiResponse({ status: 200 })
  @Delete(':id/members/:userId')
  async removeMember(
    @Param('id') id: string,
    @Param('userId') targetUserId: string,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ ok: true }> {
    await this.orgService.removeMember(id, user.userId, targetUserId);
    return { ok: true };
  }

  // ── Helpers ────────────────────────────────────────────────────

  private toDto(org: any): OrganizationDto {
    return plainToInstance(
      OrganizationDto,
      {
        _id: String(org._id),
        name: org.name,
        slug: org.slug,
        ownerId: String(org.ownerId),
        isPersonal: org.isPersonal,
        plan: org.plan,
        featureFlags: org.featureFlags ?? [],
        seatCount: org.seatCount ?? 1,
        ssoConnectionId: org.ssoConnectionId ?? null,
      },
      { excludeExtraneousValues: true },
    );
  }
}
