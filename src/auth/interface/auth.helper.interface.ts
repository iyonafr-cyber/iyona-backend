export interface IAuthHelper {
  generateUniqueId(namespace: string): string;
  generateTokens(payload: {
    userId: string;
    role: string;
    email: string;
  }): Promise<{ accessToken: string; refreshToken: string; uniqueId: string }>;
  decodeToken(token: string): Promise<{
    userId: string;
    email: string;
    role: string;
    iat: number;
    exp: number;
    uniqueId: string;
  }>;
  validatePassword(plainPassword: string, storedPassword: string): boolean;
  generateOtp(): number;
}
