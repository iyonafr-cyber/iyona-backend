import { Controller, Get, Param, Query, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { Throttle } from '@nestjs/throttler';
import { ApiKeyAuthGuard } from './guards/api-key-auth.guard';
import { RequireScopes } from './decorators/require-scope.decorator';
import { OrganizationsService } from '../organizations/organizations.service';
import { ProjectsService } from '../projects/projects.service';

/**
 * E11 — curated public REST API.
 *
 * Routes mounted under `/api/v1/public/*`. They authenticate exclusively
 * via API key + the `ApiKeyAuthGuard` (so the global `AuthGuard` is bypassed
 * via `@Public()`). Each route is throttled tighter than the SPA buckets.
 *
 * Scope policy:
 *   - read endpoints  → projects:read (admin satisfies as wildcard)
 *   - write endpoints → projects:write (none yet — added in follow-up)
 */
@ApiTags('Public API (E11)')
@ApiSecurity('api-key')
@UseGuards(ApiKeyAuthGuard)
@Throttle({ medium: { limit: 60, ttl: 60_000 } })
@Controller({ path: 'public', version: '1' })
export class PublicApiController {
  constructor(
    private readonly orgsService: OrganizationsService,
    private readonly projectsService: ProjectsService,
  ) {}

  @ApiOperation({
    summary: 'Whoami — returns the org and scopes attached to the API key.',
  })
  @Get('whoami')
  whoami(@Req() req: Request) {
    return {
      data: {
        orgId: req.apiKey?.orgId,
        scopes: req.apiKey?.scopes,
        keyId: req.apiKey?.keyId,
      },
    };
  }

  @ApiOperation({
    summary: 'List projects belonging to the org owner. Paginated.',
  })
  @RequireScopes('projects:read')
  @Get('projects')
  async listProjects(
    @Req() req: Request,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const orgId = req.apiKey.orgId;
    const ownerId = await this.resolveOrgOwnerId(orgId);
    const result = await this.projectsService.getAllProjects(
      ownerId,
      Math.max(parseInt(page ?? '1', 10) || 1, 1),
      Math.min(Math.max(parseInt(limit ?? '20', 10) || 20, 1), 100),
    );
    return { data: result };
  }

  @ApiOperation({ summary: 'Fetch a single project by id.' })
  @RequireScopes('projects:read')
  @Get('projects/:id')
  async getProject(@Req() req: Request, @Param('id') id: string) {
    const orgId = req.apiKey.orgId;
    const ownerId = await this.resolveOrgOwnerId(orgId);
    const project = await this.projectsService.getProjectById(id, ownerId);
    return { data: project };
  }

  /**
   * Until projects are migrated onto orgs (E9), the org owner's userId is
   * the canonical "primary actor" for the workspace. Personal orgs (which
   * is most of them today) collapse to the original user.
   */
  private async resolveOrgOwnerId(orgId: string): Promise<string> {
    const org = await this.orgsService.findOrgById(orgId);
    if (!org) throw new Error('Organization not found');
    return String(org.ownerId);
  }
}
