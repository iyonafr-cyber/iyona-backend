import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface CurrentUserPayload {
  userId: string;
  role: string;
  email: string;
  uniqueId?: string;
}

/**
 * Returns the decoded JWT payload attached to `request.user` by `AuthGuard`.
 * Use inside controllers guarded by `AuthGuard` to pull the authenticated
 * userId without reading the raw request object.
 */
export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): CurrentUserPayload => {
    const request = ctx.switchToHttp().getRequest();
    return request.user as CurrentUserPayload;
  },
);
