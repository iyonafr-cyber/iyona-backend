import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { ApiKeysService } from '../api-keys.service';
import { ApiKeyDocument } from '../entities/api-key.entity';
import {
  REQUIRED_SCOPES_KEY,
  type ApiKeyScopeRequirement,
} from '../decorators/require-scope.decorator';

export interface AuthenticatedApiKeyContext {
  keyId: string;
  orgId: string;
  scopes: string[];
}

declare module 'express-serve-static-core' {
  interface Request {
    apiKey?: AuthenticatedApiKeyContext;
  }
}

/**
 * Guard for the public REST API (`/api/v1/public/*`).
 *
 * Reads `X-API-Key` (or `Authorization: Bearer jv_...`), validates the key
 * against `ApiKeysService.verifyRawKey`, then enforces scopes declared on
 * the handler via `@RequireScopes(...)`.
 */
@Injectable()
export class ApiKeyAuthGuard implements CanActivate {
  constructor(
    private readonly apiKeysService: ApiKeysService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const raw = this.extractKey(req);
    if (!raw) {
      throw new UnauthorizedException('Missing X-API-Key header');
    }

    const keyDoc: ApiKeyDocument | null =
      await this.apiKeysService.verifyRawKey(raw);
    if (!keyDoc) {
      throw new UnauthorizedException('Invalid or revoked API key');
    }

    const required: ApiKeyScopeRequirement[] =
      this.reflector.getAllAndOverride(REQUIRED_SCOPES_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? [];

    if (required.length > 0) {
      const has = (s: string) =>
        keyDoc.scopes.includes(s as any) ||
        keyDoc.scopes.includes('admin' as any);
      const missing = required.filter((s) => !has(s));
      if (missing.length > 0) {
        throw new UnauthorizedException(
          `API key is missing required scope(s): ${missing.join(', ')}`,
        );
      }
    }

    req.apiKey = {
      keyId: String(keyDoc._id),
      orgId: String(keyDoc.orgId),
      scopes: keyDoc.scopes as string[],
    };
    return true;
  }

  private extractKey(req: Request): string | null {
    const header = req.headers['x-api-key'] ?? req.headers['X-API-Key' as any];
    if (typeof header === 'string' && header.trim()) return header.trim();
    if (Array.isArray(header) && header[0]) return String(header[0]).trim();

    const auth = req.headers.authorization;
    if (typeof auth === 'string' && auth.startsWith('Bearer jv_')) {
      return auth.slice('Bearer '.length).trim();
    }
    return null;
  }
}
