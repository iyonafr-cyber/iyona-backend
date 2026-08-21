import {
  Body,
  Controller,
  Get,
  Inject,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { IAuthService } from './interface/auth.service.interface';
import { LoginUserDto } from 'src/user/dto/login-user.dto';
import { UserDto } from 'src/user/dto/user.dto';
import { CreateUserDto } from 'src/user/dto/create-user.dto';
import { ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from 'src/user/roles/roles.enum';
import { LogoutDto } from './dto/logout-user.dto';
import { AuthGuard } from './guards/auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { Roles } from './decorator/roles.decorator';
import { GoogleLoginDto } from './dto/google-login.dto';
import { GitHubLoginDto } from './dto/github-login.dto';
import {
  ForgotPasswordDto,
  ResendVerificationDto,
  ResetPasswordDto,
  VerifyEmailDto,
} from './dto/forgot-password.dto';

@Controller('auth')
@Throttle({ auth: { limit: 20, ttl: 60_000 } })
export class AuthController {
  constructor(
    @Inject('IAuthService') private readonly authService: IAuthService,
  ) {}

  @ApiOperation({ summary: 'register user' })
  @Post('signup')
  async signup(@Body() dto: CreateUserDto): Promise<{ data: UserDto }> {
    const response = await this.authService.signUpUser(dto);
    return { data: response };
  }

  @ApiOperation({ summary: 'login user' })
  // Password login is the single highest-value brute-force target in the
  // app; narrow the bucket well below the general auth allowance.
  @Throttle({ auth: { limit: 5, ttl: 60_000 } })
  @Post('login')
  async login(@Body() dto: LoginUserDto): Promise<{ data: UserDto }> {
    const response = await this.authService.loginUser(dto);
    return { data: response };
  }

  @ApiOperation({
    summary: `Logout user by invalidating refresh token Role ${Object.values(UserRole).join(', ')}`,
  })
  @ApiBearerAuth('JWT-auth')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.USER, UserRole.ADMIN)
  @Post('logout')
  async logout(@Body() logoutDto: LogoutDto): Promise<{ data: string }> {
    await this.authService.logout(logoutDto.refreshToken);
    return { data: 'logout successfully' };
  }

  @ApiOperation({
    summary: `Refresh the access token using the refresh token Role ${Object.values(UserRole).join(', ')}`,
  })
  @ApiBearerAuth('JWT-auth') // Indicates Bearer Auth for Swagger UI
  @Post('refresh-token')
  async refreshToken(
    @Req() request: any,
  ): Promise<{ data: { accessToken: string; refreshToken: string } }> {
    // Get the token from the Authorization header
    const token = request.headers['authorization']?.split(' ')[1];

    // Pass the token to the authService for validation and refresh
    if (!token) {
      throw new UnauthorizedException('Authorization token is missing');
    }

    return this.authService.refreshToken(token); // Call the service with the token
  }

  @ApiOperation({
    summary:
      'Issue a short-lived HMAC-signed OAuth state nonce for Google/GitHub login',
  })
  @Get('oauth/state')
  oauthState(): { data: { state: string; expiresAt: number } } {
    return { data: this.authService.issueOAuthState() };
  }

  @ApiOperation({ summary: 'Login or signup with Google OAuth' })
  @Post('google')
  async googleLogin(@Body() dto: GoogleLoginDto): Promise<{ data: UserDto }> {
    const response = await this.authService.googleLogin(
      dto.accessToken,
      dto.state,
    );
    return { data: response };
  }

  @ApiOperation({ summary: 'Login or signup with GitHub OAuth' })
  @Post('github')
  async githubLogin(@Body() dto: GitHubLoginDto): Promise<{ data: UserDto }> {
    const response = await this.authService.githubLogin({
      code: dto.code,
      state: dto.state,
    });
    return { data: response };
  }

  @ApiOperation({ summary: 'Request a password reset email' })
  @Throttle({ auth: { limit: 5, ttl: 60_000 } })
  @Post('forgot-password')
  async forgotPassword(
    @Body() dto: ForgotPasswordDto,
  ): Promise<{ message: string }> {
    await this.authService.requestPasswordReset(dto.email);
    // Always respond identically to avoid user enumeration.
    return {
      message:
        'If an account with that email exists, a reset link has been sent.',
    };
  }

  @ApiOperation({ summary: 'Reset password using a token emailed to the user' })
  @Throttle({ auth: { limit: 10, ttl: 60_000 } })
  @Post('reset-password')
  async resetPassword(
    @Body() dto: ResetPasswordDto,
  ): Promise<{ message: string }> {
    await this.authService.resetPassword(dto.token, dto.password);
    return { message: 'Password reset successfully' };
  }

  @ApiOperation({ summary: 'Resend verification email' })
  @Throttle({ auth: { limit: 5, ttl: 60_000 } })
  @Post('resend-verification')
  async resendVerification(
    @Body() dto: ResendVerificationDto,
  ): Promise<{ message: string }> {
    await this.authService.resendVerificationEmail(dto.email);
    return {
      message:
        'If an account with that email exists and is unverified, a verification link has been sent.',
    };
  }

  @ApiOperation({ summary: 'Verify email using a token emailed to the user' })
  @Post('verify-email')
  async verifyEmail(@Body() dto: VerifyEmailDto): Promise<{ message: string }> {
    await this.authService.verifyEmail(dto.token, dto.email);
    return { message: 'Email verified' };
  }
}
