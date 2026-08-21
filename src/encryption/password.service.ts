import { Injectable, Logger } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import type { IEncryptionService } from './interface/encryption.interface.service';
import { Inject } from '@nestjs/common';

/**
 * Handles password hashing and verification. New passwords use bcrypt. Legacy
 * CryptoJS-AES passwords are accepted during login (via `IEncryptionService`)
 * and silently rehashed with bcrypt via the `rehashIfNeeded` path so the
 * reversible ciphertext disappears on first successful login.
 */
@Injectable()
export class PasswordService {
  private readonly logger = new Logger(PasswordService.name);
  private readonly saltRounds = 12;

  constructor(
    @Inject('IEncryptionService')
    private readonly encryptionService: IEncryptionService,
  ) {}

  /**
   * Produce a bcrypt hash for a new/updated password.
   */
  async hash(plainPassword: string): Promise<string> {
    return bcrypt.hash(plainPassword, this.saltRounds);
  }

  /**
   * A bcrypt hash always starts with `$2a$`, `$2b$`, `$2x$` or `$2y$`.
   * Anything else is treated as a legacy CryptoJS AES ciphertext.
   */
  isBcryptHash(storedPassword: string | null | undefined): boolean {
    if (!storedPassword) return false;
    return /^\$2[abxy]\$/.test(storedPassword);
  }

  /**
   * Verify a plaintext password against whatever we have on record.
   *
   * Returns `{ valid, needsRehash }`:
   *   - `valid=true` means the password matches.
   *   - `needsRehash=true` means the stored value is in legacy format and the
   *     caller should persist a fresh bcrypt hash (obtained via `hash`) before
   *     completing the login response.
   */
  async verify(
    plainPassword: string,
    storedPassword: string | null | undefined,
  ): Promise<{ valid: boolean; needsRehash: boolean }> {
    if (!storedPassword) {
      return { valid: false, needsRehash: false };
    }

    if (this.isBcryptHash(storedPassword)) {
      const valid = await bcrypt.compare(plainPassword, storedPassword);
      return { valid, needsRehash: false };
    }

    // Legacy CryptoJS AES ciphertext. Attempt to decrypt and compare.
    try {
      const decrypted = this.encryptionService.decrypt(storedPassword);
      const valid = decrypted === plainPassword;
      return { valid, needsRehash: valid };
    } catch (error) {
      this.logger.warn(
        'Failed to decrypt legacy password blob; treating as invalid',
        error as Error,
      );
      return { valid: false, needsRehash: false };
    }
  }
}
