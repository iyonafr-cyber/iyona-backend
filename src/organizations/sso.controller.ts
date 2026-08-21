import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ConfigService } from '@nestjs/config';

import { AuthGuard } from '../auth/guards/auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorator/roles.decorator';
import { UserRole } from '../user/roles/roles.enum';
import {
  CurrentUser,
  CurrentUserPayload,
} from '../auth/decorator/current-user.decorator';
import { Public } from '../auth/decorator/public.decorator';

import { SsoService } from './sso.service';
import { OrganizationsService } from './organizations.service';

/**
 * E10 — SSO controller.
 *
 * Two route groups:
 *   - `/auth/sso/*` — public start + callback used by the login page.
 *   - `/organizations/:orgId/sso` — JWT-protected admin config. The
 *     org owner uses these to set the SSO domain, generate a WorkOS
 *     admin portal link, and flip the "require SSO" switch.
 */
@Controller()
export class SsoController {
  constructor(
    private readonly sso: SsoService,
    private readonly orgs: OrganizationsService,
    private readonly config: ConfigService,
  ) {}

  // ─── Public auth endpoints ────────────────────────────────────────

  @Public()
  @Get('auth/sso/check')
  async check(@Query('email') email: string): Promise<{
    available: boolean;
    required: boolean;
  }> {
    if (!email) return { available: false, required: false };
    if (!this.sso.isEnabled()) return { available: false, required: false };
    const org = await this.sso.findOrgForEmail(email);
    return {
      available: !!org?.ssoConnectionId,
      required: !!org?.ssoRequired,
    };
  }

  @Public()
  @Get('auth/sso/start')
  async start(
    @Query('email') email: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    if (!email) throw new BadRequestException('email is required');
    const redirectUri =
      this.config.get<string>('WORKOS_REDIRECT_URI') ||
      this.deriveCallbackUrl(req);
    try {
      const url = await this.sso.buildAuthorizationUrl(email, redirectUri);
      res.redirect(url);
    } catch (err) {
      const fallback = this.config.get<string>('PUBLIC_FRONTEND_URL') || '/';
      res.redirect(
        `${fallback.replace(/\/$/, '')}/login?ssoError=${encodeURIComponent(
          err instanceof Error ? err.message : 'sso_unavailable',
        )}`,
      );
    }
  }

  /**
   * Build a fully-qualified callback URL using:
   *   1. PUBLIC_BACKEND_URL when set (preferred — survives proxy churn),
   *   2. otherwise the X-Forwarded-* headers WorkOS will see anyway,
   *   3. and finally falls back to whatever the request thinks is its
   *      origin so local development works without env tweaks.
   *
   * WorkOS rejects relative or schemeless redirects, so we never want
   * the callback to silently degrade to a path-only string.
   */
  private deriveCallbackUrl(req: Request): string {
    const configured = this.config.get<string>('PUBLIC_BACKEND_URL');
    const base = configured?.replace(/\/$/, '') || this.requestOrigin(req);
    return `${base}/api/v1/auth/sso/callback`;
  }

  private requestOrigin(req: Request): string {
    const proto =
      (req.headers['x-forwarded-proto'] as string | undefined)?.split(',')[0] ??
      req.protocol ??
      'https';
    const host =
      (req.headers['x-forwarded-host'] as string | undefined) ??
      req.headers.host ??
      'localhost';
    return `${proto}://${host}`;
  }

  @Public()
  @Get('auth/sso/callback')
  async callback(
    @Query('code') code: string,
    @Res() res: Response,
  ): Promise<void> {
    const fallback = (
      this.config.get<string>('PUBLIC_FRONTEND_URL') || '/'
    ).replace(/\/$/, '');
    if (!code) {
      res.redirect(`${fallback}/login?ssoError=missing_code`);
      return;
    }
    try {
      const result = await this.sso.completeAuthorization(code);
      const url = new URL(`${fallback}/login`);
      url.searchParams.set('ssoAccessToken', result.accessToken);
      url.searchParams.set('ssoRefreshToken', result.refreshToken);
      if (result.orgId) url.searchParams.set('orgId', result.orgId);
      res.redirect(url.toString());
    } catch (err) {
      res.redirect(
        `${fallback}/login?ssoError=${encodeURIComponent(
          err instanceof Error ? err.message : 'sso_failed',
        )}`,
      );
    }
  }

  // ─── Admin config (JWT) ───────────────────────────────────────────

  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.USER)
  @Get('organizations/:orgId/sso')
  async getConfig(
    @Param('orgId') orgId: string,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{
    enabled: boolean;
    ssoConnectionId: string | null;
    ssoDomain: string | null;
    ssoRequired: boolean;
  }> {
    await this.orgs.requireMembership(orgId, user.userId);
    const org = await this.orgs.findOrgById(orgId);
    return {
      enabled: this.sso.isEnabled(),
      ssoConnectionId: org?.ssoConnectionId ?? null,
      ssoDomain: org?.ssoDomain ?? null,
      ssoRequired: !!org?.ssoRequired,
    };
  }

  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.USER)
  @Patch('organizations/:orgId/sso')
  async updateConfig(
    @Param('orgId') orgId: string,
    @CurrentUser() user: CurrentUserPayload,
    @Body()
    body: {
      ssoConnectionId?: string | null;
      ssoDomain?: string | null;
      ssoRequired?: boolean;
    },
  ): Promise<{ ok: true }> {
    await this.orgs.requireRole(orgId, user.userId, 'admin');
    await this.sso.upsertSsoConfig(orgId, body);
    return { ok: true };
  }

  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.USER)
  @Post('organizations/:orgId/sso/admin-portal')
  async portalLink(
    @Param('orgId') orgId: string,
    @CurrentUser() user: CurrentUserPayload,
    @Body() body: { returnUrl?: string } = {},
  ): Promise<{ url: string }> {
    await this.orgs.requireRole(orgId, user.userId, 'admin');
    const returnUrl =
      body.returnUrl ||
      `${this.config.get<string>('PUBLIC_FRONTEND_URL') ?? ''}/workspace/sso`;
    if (!this.sso.isEnabled()) {
      throw new BadRequestException(
        'SSO is not configured on this server (WORKOS_API_KEY missing).',
      );
    }
    const { link } = await this.sso.createAdminPortalLink(orgId, returnUrl);
    return { url: link };
  }
}
