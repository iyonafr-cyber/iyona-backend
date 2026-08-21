import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Owner-supplied credentials for their own Supabase project (decision 07).
 *
 * Only the URL and anon key are required — those are all deploy and codegen
 * need. The two optional credentials each unlock one specific capability, and
 * the settings UI should say so rather than presenting them as blanks to fill:
 *
 * - `dbUrl` → Jarvis applies schema changes automatically. Without it, the
 *   owner gets a copy-paste SQL script instead.
 * - `serviceRoleKey` → Jarvis can create the generated app's admin account.
 */
export class ConnectSupabaseDto {
  @ApiProperty({
    description: 'Supabase project URL, e.g. https://abcdefghijklmnop.supabase.co',
    example: 'https://abcdefghijklmnop.supabase.co',
  })
  @IsString()
  @MinLength(1, { message: 'Supabase project URL is required' })
  @MaxLength(2048)
  url: string;

  @ApiProperty({
    description:
      'Supabase anon / publishable key. Ships to the browser by design and is RLS-gated.',
  })
  @IsString()
  @MinLength(1, { message: 'Anon key is required' })
  @MaxLength(4096)
  anonKey: string;

  @ApiPropertyOptional({
    description:
      'Postgres connection string (Session pooler, port 5432). Enables automatic ' +
      'schema migrations. Stored encrypted, server-only, never injected into builds.',
    example:
      'postgresql://postgres.<ref>:<password>@aws-0-eu-central-1.pooler.supabase.com:5432/postgres',
  })
  @IsOptional()
  @IsString()
  @MaxLength(4096)
  dbUrl?: string;

  @ApiPropertyOptional({
    description:
      "Service role key. Only used to create the generated app's admin account. " +
      'Never sent to the browser.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(4096)
  serviceRoleKey?: string;
}
