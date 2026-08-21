import { SetMetadata } from '@nestjs/common';
import type { ApiKeyScope } from '../entities/api-key.entity';

export type ApiKeyScopeRequirement = ApiKeyScope;

export const REQUIRED_SCOPES_KEY = 'api_key_required_scopes';

/**
 * Declare which scopes the caller's API key must have to invoke this
 * handler. The `admin` scope is treated as a wildcard by the guard.
 */
export const RequireScopes = (...scopes: ApiKeyScopeRequirement[]) =>
  SetMetadata(REQUIRED_SCOPES_KEY, scopes);
