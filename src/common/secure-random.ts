import { randomBytes, randomInt } from 'crypto';

/**
 * Centralized CSPRNG helpers. Use these instead of `Math.random()` for
 * anything that ends up in a token, OTP, OAuth state, password, or
 * URL slug — `Math.random` is not cryptographically secure and can be
 * predicted from a few prior outputs by anyone running the same V8
 * version.
 */

const URL_SAFE_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

const PASSWORD_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';

/**
 * Generate a `length`-character URL-safe random string from
 * `[A-Za-z0-9]`. Suitable for slug suffixes, request ids, and short
 * tokens that are stored in the URL bar.
 */
export function secureRandomSlug(length: number): string {
  if (length <= 0) return '';
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) {
    out += URL_SAFE_ALPHABET[bytes[i] % URL_SAFE_ALPHABET.length];
  }
  return out;
}

/**
 * Generate an N-digit numeric OTP using the system CSPRNG. Returns a
 * string so callers don't lose leading zeros (`042315`).
 */
export function secureNumericOtp(digits: number): string {
  if (digits <= 0) throw new Error('digits must be > 0');
  let out = '';
  for (let i = 0; i < digits; i++) {
    out += String(randomInt(0, 10));
  }
  return out;
}

/**
 * Hex-encoded random token. Use for OAuth `state`, single-use links,
 * etc. 32 hex chars (16 bytes) is plenty for CSRF / state parameters.
 */
export function secureHexToken(bytes = 16): string {
  return randomBytes(bytes).toString('hex');
}

/**
 * Generate a random password with mixed-case letters, digits, and a
 * small set of symbols. Used by the Supabase project provisioning
 * flow where we own the DB password and only need it long enough to
 * hand off to Supabase.
 */
export function secureRandomPassword(length: number): string {
  if (length <= 0) return '';
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) {
    out += PASSWORD_ALPHABET[bytes[i] % PASSWORD_ALPHABET.length];
  }
  return out;
}
