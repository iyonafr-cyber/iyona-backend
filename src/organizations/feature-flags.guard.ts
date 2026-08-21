import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  SetMetadata,
  forwardRef,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { OrganizationsService } from './organizations.service';

export const FEATURE_FLAG_KEY = 'feature_flag';

// NOTE(cleanup): This guard + decorator is intentionally unused at the
// moment. It's the wire-frame for per-org feature gating (E13 / Phase 2-4
// roadmap). Do NOT delete in dead-code passes; add `@RequireFeatureFlag()`
// on new controllers as gated features land.

/**
 * Decorator that requires the caller's active org to have the given
 * feature flag enabled. Use on controller methods to gate Phase 2-4
 * epics behind a per-workspace switch.
 *
 *   @RequireFeatureFlag('templates_gallery')
 *   @Get('templates') ...
 */
export const RequireFeatureFlag = (flag: string): MethodDecorator =>
  SetMetadata(FEATURE_FLAG_KEY, flag);

@Injectable()
export class FeatureFlagsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(forwardRef(() => OrganizationsService))
    private readonly orgs: OrganizationsService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const flag = this.reflector.getAllAndOverride<string>(FEATURE_FLAG_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!flag) return true;

    const req = ctx.switchToHttp().getRequest<{
      user?: { userId?: string };
      params?: Record<string, string | undefined>;
      headers?: Record<string, string | string[] | undefined>;
    }>();
    const userId = req.user?.userId;
    if (!userId) {
      throw new ForbiddenException('Authentication required for this feature.');
    }

    const headerOrg = req.headers?.['x-org-id'];
    const orgId =
      req.params?.orgId ||
      (typeof headerOrg === 'string' ? headerOrg : undefined) ||
      null;

    let enabled = false;
    try {
      let resolvedOrgId = orgId;
      if (!resolvedOrgId) {
        // Prefer the user's persisted "current" org so feature gates
        // follow whichever workspace the user has actively switched into,
        // not the personal one. Falls back to lazily provisioning a
        // personal org when nothing is set yet.
        resolvedOrgId = await this.orgs.getActiveOrgId(userId);
        if (!resolvedOrgId) {
          const personal = await this.orgs.ensurePersonalOrg(userId);
          const personalId = (personal as { _id: { toString(): string } })._id;
          resolvedOrgId = personalId.toString();
        }
      }
      const org = await this.orgs.findOrgById(resolvedOrgId);
      enabled = !!org?.featureFlags?.includes(flag);
    } catch {
      enabled = false;
    }

    if (!enabled) {
      throw new ForbiddenException(
        `Feature "${flag}" is not enabled for this workspace.`,
      );
    }
    return true;
  }
}
