import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Credentials for the GENERATED app's admin account — not a Jarvis account.
 *
 * The password is forwarded to that project's Supabase Auth, which hashes it.
 * Jarvis stores only the email, so the settings panel can show who the admin
 * is without ever holding a recoverable secret.
 */
export class SetAppAdminDto {
  @ApiProperty({
    description: "Email for the generated app's admin login",
    example: 'admin@myshop.com',
  })
  @IsEmail({}, { message: 'Enter a valid email address' })
  @MaxLength(254)
  email: string;

  @ApiProperty({
    description:
      'Password for the admin login. Minimum 8 characters — Supabase Auth ' +
      'hashes it; Jarvis never stores it.',
    minLength: 8,
    maxLength: 72,
  })
  @IsString()
  // 8 is Supabase Auth's own default floor; 72 is the bcrypt input limit,
  // beyond which extra characters are silently ignored.
  @MinLength(8, { message: 'Password must be at least 8 characters' })
  @MaxLength(72)
  password: string;
}
