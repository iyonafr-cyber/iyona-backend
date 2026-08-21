import { SetMetadata } from '@nestjs/common';

/**
 * Metadata key used by `AuthGuard` / `RolesGuard` to short-circuit and allow
 * anonymous traffic on a specific handler. Attach with `@Public()`.
 */
export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Marks a controller method (or whole controller) as reachable without a
 * valid access token. Prefer this over conditionally mounting guards.
 *
 * Usage:
 *   @Public()
 *   @Get('health')
 *   health() { ... }
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
