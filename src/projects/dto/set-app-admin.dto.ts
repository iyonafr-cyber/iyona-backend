import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Credentials for the GENERATED app's admin account — not a Iyona account.
 *
 * The password is forwarded to that project's Supabase Auth, which hashes it.
 * Iyona stores only the email, so the settings panel can show who the admin
 * is without ever holding a recoverable secret.
 */
export class SetAppAdminDto {
  @IsEmail({}, { message: 'Enter a valid email address' })
  @MaxLength(254)
  email: string;

  @IsString()
  // 8 is Supabase Auth's own default floor; 72 is the bcrypt input limit,
  // beyond which extra characters are silently ignored.
  @MinLength(8, { message: 'Password must be at least 8 characters' })
  @MaxLength(72)
  password: string;
}
