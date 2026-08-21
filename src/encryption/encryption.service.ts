// src/encryption/encryption.service.ts
import { BadRequestException, Injectable } from '@nestjs/common';
import * as CryptoJS from 'crypto-js';
import type { IEncryptionService } from './interface/encryption.interface.service';

@Injectable()
export class EncryptionService implements IEncryptionService {
  private readonly secretKey: string;

  constructor() {
    if (!process.env.ENCRYPTION_KEY) {
      throw new BadRequestException('crypto secret required in .env');
    }
    // Load the secret key from environment variables in production
    this.secretKey = process.env.ENCRYPTION_KEY;
  }

  /**
   * Encrypts the provided text using a single secret key
   * @param text The text to encrypt
   * @returns Encrypted text
   */
  encrypt(text: string): string {
    try {
      return CryptoJS.AES.encrypt(text, this.secretKey).toString();
    } catch (error) {
      throw new Error(`Encryption failed: ${error.message}`);
    }
  }

  /**
   * Decrypts the provided encrypted text using the same secret key
   * @param encryptedText The encrypted text
   * @returns Decrypted text
   */
  decrypt(encryptedText: string): string {
    try {
      const bytes = CryptoJS.AES.decrypt(encryptedText, this.secretKey);
      const decrypted = bytes.toString(CryptoJS.enc.Utf8);
      if (!decrypted) {
        throw new Error('Invalid encrypted text or secret key');
      }
      return decrypted;
    } catch (error) {
      throw new Error(`Decryption failed: ${error.message}`);
    }
  }
}
