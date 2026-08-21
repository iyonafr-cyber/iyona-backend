import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { v4 as uuidv4 } from 'uuid';
import { IAuthHelper } from '../interface/auth.helper.interface';
import { UserRole } from 'src/user/roles/roles.enum';
import { DecodedJwtToken } from '../dto/decodedToken.dto';
import type { IEncryptionService } from 'src/encryption/interface/encryption.interface.service';
import { secureNumericOtp } from 'src/common/secure-random';

@Injectable()
export class AuthHelper implements IAuthHelper {
  constructor(
    private readonly jwtService: JwtService,
    @Inject('IEncryptionService')
    private readonly encryptionService: IEncryptionService,
  ) {}

  // Generate Unique Id
  generateUniqueId(namespace: string): string {
    const timestamp = Date.now(); // Current timestamp in milliseconds
    const randomString = uuidv4(); // Generate a UUID (Universally Unique Identifier)
    return `${namespace}-${timestamp}-${randomString}`;
  }

  // Generate Token
  generateTokens(payload: {
    userId: string;
    role: UserRole;
    email: string;
  }): Promise<{ accessToken: string; refreshToken: string; uniqueId: string }> {
    // generate otp
    const uniqueId = this.generateUniqueId('default');
    const accessToken = this.jwtService.sign(
      {
        userId: payload.userId,
        email: payload.email,
        role: payload.role,
        uniqueId,
      },
      {
        secret: process.env.JWT_SECRET,
        expiresIn: process.env.JWT_AccessTokenExpiry as any,
      },
    );
    const refreshToken = this.jwtService.sign(
      {
        userId: payload.userId,
        email: payload.email,
        role: payload.role,
        uniqueId,
      },
      {
        secret: process.env.JWT_SECRET,
        expiresIn: process.env.JWT_RefreshTokenExpiry as any,
      },
    );

    return Promise.resolve({ accessToken, refreshToken, uniqueId });
  }

  // Decode Token
  async decodeToken(token: string): Promise<DecodedJwtToken> {
    return this.jwtService.verify(token);
  }

  // Method to validate password on login
  validatePassword(plainPassword: string, storedPassword: string): boolean {
    const decryptedPassword = this.encryptionService.decrypt(storedPassword);
    return plainPassword === decryptedPassword;
  }

  // Generate OTP — uses CSPRNG, returns a 6-digit string so leading
  // zeros survive the wire ('042315' is otherwise lost when sent as a
  // number). Callers that still need a number can `Number(...)` it.
  generateOtp(): number {
    return Number(secureNumericOtp(6));
  }
}
