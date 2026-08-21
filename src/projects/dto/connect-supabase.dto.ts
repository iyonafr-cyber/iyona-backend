import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Owner-supplied credentials for their own Supabase project (decision 07).
 *
 * Only the URL and anon key are required — those are all deploy and codegen
 * need. The two optional credentials each unlock one specific capability, and
 * the settings UI should say so rather than presenting them as blanks to fill:
 *
 * - `dbUrl` → Iyona applies schema changes automatically. Without it, the
 *   owner gets a copy-paste SQL script instead.
 * - `serviceRoleKey` → Iyona can create the generated app's admin account.
 */
export class ConnectSupabaseDto {
  @IsString()
  @MinLength(1, { message: 'Supabase project URL is required' })
  @MaxLength(2048)
  url: string;

  @IsString()
  @MinLength(1, { message: 'Anon key is required' })
  @MaxLength(4096)
  anonKey: string;

  @IsOptional()
  @IsString()
  @MaxLength(4096)
  dbUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4096)
  serviceRoleKey?: string;
}
