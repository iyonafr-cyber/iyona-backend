import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * E13 — payload for `PUT /projects/:id/analytics`. Lets the project
 * owner attach Plausible or PostHog (or none) to their deployed app.
 *
 * The backend stores this on `UserProject.analytics` and pipes it into
 * Vercel build env on the next deploy. The workspace iframe also gets
 * a `iyona:setAnalytics` message so the preview-bridge can mirror the
 * provider live without waiting for a redeploy.
 */
export class UpdateAnalyticsDto {
  @IsEnum(['none', 'plausible', 'posthog'])
  provider: 'none' | 'plausible' | 'posthog';

  /**
   * Plausible: site domain (e.g. `myapp.com`). PostHog: project API
   * key (`phc_...`). Empty when provider === 'none'.
   */
  @IsOptional()
  @IsString()
  @MaxLength(256)
  key?: string;

  /**
   * Self-hosted host override. Defaults to the public hosted endpoint
   * for each provider when empty.
   */
  @IsOptional()
  @IsString()
  @MaxLength(256)
  host?: string;
}
