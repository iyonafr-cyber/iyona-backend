import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import * as dotenv from 'dotenv';
import type { IUserHelper } from 'src/user/interface/user.helper.interface';
import type { IAuthHelper } from '../interface/auth.helper.interface';
import mongoose from 'mongoose';
import { IS_PUBLIC_KEY } from '../decorator/public.decorator';

dotenv.config();

/**
 * AuthGuard validates JWT access tokens. Notable properties vs the previous
 * implementation:
 *
 *   - No per-request mutation of the user document (the old "updatedAt =
 *     new Date()" write was generating one write per authenticated request).
 *   - No per-request decoding of every refresh JWT stored on the user. Session
 *     validity is now checked via a single `Array.includes` against the new
 *     `sessionIds` field, populated at login / refresh time.
 *   - Honors the `@Public()` decorator so specific handlers can opt out of
 *     authentication without the controller needing to omit `@UseGuards`.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject('IUserHelper') private readonly userHelper: IUserHelper,
    @Inject('IAuthHelper') private readonly authHelper: IAuthHelper,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    try {
      const request = context.switchToHttp().getRequest();
      const token = this.extractTokenFromHeader(request);

      if (!token) {
        throw new UnauthorizedException('Authorization token is missing');
      }

      const url = request.url ?? '';
      const isRefreshTokenEndpoint = url.includes('/auth/refresh-token');

      let payload;
      try {
        payload = await this.authHelper.decodeToken(String(token));
      } catch {
        if (isRefreshTokenEndpoint) {
          throw new UnauthorizedException('Invalid refresh token');
        }
        throw new UnauthorizedException('Invalid access token');
      }

      const [user] = await this.userHelper.findUserWithSchema({
        _id: new mongoose.Types.ObjectId(payload.userId),
      });

      if (!user) {
        throw new UnauthorizedException('User not found');
      }
      if (!user.isVerified) {
        throw new UnauthorizedException('User is not verified');
      }
      if (user.isDeleted) {
        throw new UnauthorizedException('User account is deleted');
      }
      if ((user as any).isSuspended) {
        throw new UnauthorizedException('User account is suspended');
      }

      // Session validation (skipped on the refresh endpoint; the refresh
      // service runs its own, stricter check using the presented refresh
      // token's uniqueId).
      if (!isRefreshTokenEndpoint) {
        const sessionIds = Array.isArray(user.sessionIds)
          ? user.sessionIds
          : [];
        if (!payload.uniqueId || !sessionIds.includes(payload.uniqueId)) {
          throw new UnauthorizedException(
            'Session expired or revoked, please log in again',
          );
        }
      }

      request['user'] = payload;
      request['fullUser'] = user;
      return true;
    } catch (error) {
      // Avoid leaking internals; surface the message that was thrown.
      throw new UnauthorizedException(error.message || 'Authentication failed');
    }
  }

  private extractTokenFromHeader(request: Request): string | undefined {
    const [type, token] = request.headers.authorization?.split(' ') ?? [];
    return type === 'Bearer' ? token : undefined;
  }
}
