import { CreateUserDto } from 'src/user/dto/create-user.dto';
import { LoginUserDto } from 'src/user/dto/login-user.dto';
import { UserDto } from 'src/user/dto/user.dto';

export interface IAuthService {
  signUpUser(dto: CreateUserDto): Promise<UserDto>;
  loginUser(dto: LoginUserDto): Promise<UserDto>;
  logout(refreshToken: string): Promise<void>;
  refreshToken(
    refreshToken: string,
  ): Promise<{ data: { accessToken: string; refreshToken: string } }>;
  googleLogin(accessToken: string, state?: string): Promise<UserDto>;
  githubLogin(input: { code: string; state?: string }): Promise<UserDto>;
  issueOAuthState(): { state: string; expiresAt: number };
  requestPasswordReset(email: string): Promise<void>;
  resetPassword(token: string, newPassword: string): Promise<void>;
  resendVerificationEmail(email: string): Promise<void>;
  verifyEmail(token: string, email?: string): Promise<void>;
}
