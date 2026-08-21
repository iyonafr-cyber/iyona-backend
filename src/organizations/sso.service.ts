import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  Organization,
  OrganizationDocument,
} from './entities/organization.entity';
import { User } from '../user/entities/user.entity';
import { OrgMember } from './entities/org-member.entity';
import { OrganizationsService } from './organizations.service';
import { IAuthHelper } from '../auth/interface/auth.helper.interface';
import { UserRole } from '../user/roles/roles.enum';
import { withObservability } from '../common/observability';

/**
 * E10 — SSO/SAML via WorkOS.
 *
 * Wraps the WorkOS SDK behind a service that gracefully no-ops when
 * the platform isn't configured for SSO. Two responsibilities:
 *
 *   1. Resolve a sign-in email to a WorkOS connection (by org domain)
 *      and produce an authorization URL the SPA can redirect to.
 *   2. Exchange the callback `code` for a WorkOS profile, then look
 *      up / create the local user and issue our own JWT — so SSO
 *      logins drop the user into exactly the same session shape as
 *      a password login.
 *
 * We intentionally keep the WorkOS client typed loosely (`unknown`
 * cast through narrow helper types). Pinning the WorkOS SDK version
 * across our zoo of NestJS deps was painful, and the surface we use
 * is small + stable.
 */
@Injectable()
export class SsoService {
  private readonly logger = new Logger(SsoService.name);
  private workos: WorkOsClient | null = null;
  private clientId: string | null = null;

  constructor(
    @InjectModel(Organization.name)
    private readonly orgModel: Model<OrganizationDocument>,
    @InjectModel(User.name) private readonly userModel: Model<User>,
    @InjectModel(OrgMember.name)
    private readonly memberModel: Model<OrgMember>,
    private readonly config: ConfigService,
    @Optional()
    @Inject('IAuthHelper')
    private readonly authHelper?: IAuthHelper,
    @Optional() private readonly orgs?: OrganizationsService,
  ) {
    const apiKey = this.config.get<string>('WORKOS_API_KEY');
    const clientId = this.config.get<string>('WORKOS_CLIENT_ID');
    if (apiKey && clientId) {
      try {
        // Lazy require to avoid hard-failing boot when SDK is absent.
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { WorkOS } = require('@workos-inc/node') as {
          WorkOS: new (key: string) => WorkOsClient;
        };
        this.workos = new WorkOS(apiKey);
        this.clientId = clientId;
        this.logger.log('WorkOS SSO ready');
      } catch (err) {
        this.logger.warn(
          `WorkOS SDK present but failed to init: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    } else {
      this.logger.log(
        'WORKOS_API_KEY / WORKOS_CLIENT_ID not set — SSO endpoints disabled',
      );
    }
  }

  isEnabled(): boolean {
    return !!this.workos && !!this.clientId;
  }

  /**
   * Find an org with `ssoDomain` matching the email's domain. Returns
   * null if no match (caller falls back to normal login).
   */
  async findOrgForEmail(email: string): Promise<OrganizationDocument | null> {
    const at = email.indexOf('@');
    if (at < 0) return null;
    const domain = email
      .slice(at + 1)
      .toLowerCase()
      .trim();
    if (!domain) return null;
    return this.orgModel
      .findOne({ ssoDomain: domain, ssoConnectionId: { $ne: null } })
      .exec();
  }

  /**
   * Build the redirect URL that starts the SSO dance for `email`.
   * Throws when SSO isn't configured for the email's domain.
   */
  async buildAuthorizationUrl(
    email: string,
    redirectUri: string,
    state?: string,
  ): Promise<string> {
    if (!this.workos || !this.clientId) {
      throw new Error('SSO not configured on this server');
    }
    const org = await this.findOrgForEmail(email);
    if (!org || !org.ssoConnectionId) {
      throw new Error('No SSO connection found for this email domain');
    }
    return this.workos.sso.getAuthorizationUrl({
      clientId: this.clientId,
      redirectUri,
      connection: org.ssoConnectionId,
      state,
    });
  }

  /**
   * Generate an admin-portal link the org owner uses to configure
   * their IdP inside WorkOS. We pre-create or reuse a WorkOS
   * Organization so the resulting `connection.id` is easy to wire
   * back into our DB via the standard WorkOS webhook.
   */
  async createAdminPortalLink(
    orgId: string,
    returnUrl: string,
  ): Promise<{ link: string }> {
    if (!this.workos || !this.clientId) {
      throw new Error('SSO not configured on this server');
    }
    const org = await this.orgModel.findById(orgId);
    if (!org) throw new Error('Organization not found');

    const portal = await withObservability(
      'workos.portal.generateLink',
      () =>
        this.workos.portal.generateLink({
          organization: orgId,
          intent: 'sso',
          returnUrl,
        }),
      { orgId },
    );
    return { link: portal.link };
  }

  /**
   * Complete the OAuth-style code exchange. Returns the issued JWT
   * plus the resolved user/org so the SPA can hydrate Redux without
   * an extra round-trip.
   */
  async completeAuthorization(code: string): Promise<{
    accessToken: string;
    refreshToken: string;
    userId: string;
    orgId: string | null;
    email: string;
  }> {
    if (!this.workos || !this.clientId || !this.authHelper) {
      throw new Error('SSO not configured on this server');
    }
    const profile = await withObservability(
      'workos.sso.getProfileAndToken',
      () =>
        this.workos.sso.getProfileAndToken({
          code,
          clientId: this.clientId,
        }),
    );
    const email = (profile.profile.email || '').toLowerCase();
    if (!email) throw new Error('SSO profile is missing an email');

    let user = await this.userModel.findOne({ email }).exec();
    if (!user) {
      user = await this.userModel.create({
        email,
        isVerified: true,
      } as Partial<User>);
    }

    const org = await this.findOrgForEmail(email);
    let orgId: string | null = org?._id ? String(org._id) : null;

    if (org && this.orgs) {
      const userIdStr = String(user._id);
      try {
        await this.orgs.requireMembership(orgId, userIdStr);
      } catch {
        await this.memberModel.create({
          orgId: org._id,
          userId: user._id,
          role: 'member',
        });
      }
      try {
        await this.orgs.switchOrg(userIdStr, orgId);
      } catch {
        await this.userModel.updateOne(
          { _id: user._id },
          { $set: { currentOrgId: org._id } },
        );
      }
    }

    if (!orgId && this.orgs) {
      try {
        const personal = await this.orgs.ensurePersonalOrg(String(user._id));
        orgId = String(personal._id);
      } catch {
        /* leave null; next login will retry */
      }
    }

    const { accessToken, refreshToken, uniqueId } =
      await this.authHelper.generateTokens({
        userId: String(user._id),
        email,
        role: user.role ?? UserRole.USER,
      });

    await this.userModel
      .updateOne(
        { _id: user._id },
        {
          $push: { sessionIds: { $each: [uniqueId], $slice: -10 } },
          $set: { lastLoginAt: new Date() },
        },
      )
      .exec();

    return {
      accessToken,
      refreshToken,
      userId: String(user._id),
      orgId,
      email,
    };
  }

  async upsertSsoConfig(
    orgId: string,
    patch: {
      ssoConnectionId?: string | null;
      ssoDomain?: string | null;
      ssoRequired?: boolean;
    },
  ): Promise<OrganizationDocument | null> {
    const update: Record<string, unknown> = {};
    if ('ssoConnectionId' in patch)
      update.ssoConnectionId = patch.ssoConnectionId || null;
    if ('ssoDomain' in patch)
      update.ssoDomain = patch.ssoDomain
        ? patch.ssoDomain.toLowerCase().trim()
        : null;
    if ('ssoRequired' in patch) update.ssoRequired = !!patch.ssoRequired;
    if (Object.keys(update).length === 0) {
      return this.orgModel.findById(orgId).exec();
    }
    return this.orgModel
      .findByIdAndUpdate(
        new Types.ObjectId(orgId),
        { $set: update },
        { new: true },
      )
      .exec();
  }
}

// Narrow types so we don't depend on the WorkOS SDK's type tree at
// compile time (its declarations have churned across versions).
type WorkOsClient = {
  sso: {
    getAuthorizationUrl(args: {
      clientId: string;
      redirectUri: string;
      connection?: string;
      organization?: string;
      domain?: string;
      state?: string;
    }): string;
    getProfileAndToken(args: { code: string; clientId: string }): Promise<{
      profile: {
        id: string;
        email: string;
        firstName?: string;
        lastName?: string;
        connectionId?: string;
      };
      access_token?: string;
    }>;
  };
  portal: {
    generateLink(args: {
      organization: string;
      intent: string;
      returnUrl?: string;
    }): Promise<{ link: string }>;
  };
};
