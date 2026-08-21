import {
  BadRequestException,
  forwardRef,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { IAuthService } from './interface/auth.service.interface';
import type { IUserHelper } from 'src/user/interface/user.helper.interface';
import { CreateUserDto } from 'src/user/dto/create-user.dto';
import { UserDto } from 'src/user/dto/user.dto';
import type { IEncryptionService } from 'src/encryption/interface/encryption.interface.service';
import { PasswordService } from 'src/encryption/password.service';
import { LoginUserDto } from 'src/user/dto/login-user.dto';
import { plainToInstance } from 'class-transformer';
import type { IAuthHelper } from './interface/auth.helper.interface';
import mongoose from 'mongoose';
import { logAndThrowError } from 'src/utils/error.utils';
import axios from 'axios';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { EmailService } from 'src/email/email.service';
import { CreditsService } from 'src/credits/credits.service';

@Injectable()
export class AuthService implements IAuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @Inject('IAuthHelper') private readonly authHelper: IAuthHelper,
    @Inject('IUserHelper') private readonly userHelper: IUserHelper,
    @Inject('IEncryptionService')
    private readonly encryptionService: IEncryptionService,
    private readonly passwordService: PasswordService,
    private readonly emailService: EmailService,
    @Inject(forwardRef(() => CreditsService))
    private readonly creditsService: CreditsService,
  ) {}

  private async tryGrantSignupWelcomeBonus(userId: string): Promise<number> {
    try {
      return await this.creditsService.grantSignupWelcomeBonus(userId);
    } catch (err) {
      this.logger.error(
        `signup welcome bonus skipped for ${userId}: ${(err as Error).message}`,
      );
      return 0;
    }
  }

  // ──────────────────────────────────────────────────────────────
  // Password reset + email verification
  // ──────────────────────────────────────────────────────────────

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private frontendBaseUrl(): string {
    return (
      process.env.FRONTEND_BASE_URL?.replace(/\/$/, '') || 'https://jarvis.site'
    );
  }

  /**
   * Generate a password-reset token for the given email. Always behaves the
   * same from the caller's perspective (even if the email is unknown) to
   * avoid user-enumeration. Sends an email via EmailService.
   */
  async requestPasswordReset(email: string): Promise<void> {
    try {
      const normalized = (email || '').trim().toLowerCase();
      const [user] = await this.userHelper.findUserWithSchema({
        email: normalized,
      });
      if (!user || user.isDeleted) {
        return; // silent — don't leak whether the email exists
      }
      const rawToken = randomBytes(32).toString('hex');
      const hashed = this.hashToken(rawToken);
      const expires = new Date(Date.now() + 60 * 60 * 1000); // 1h

      await this.userHelper.updateUser({ _id: user._id }, {
        passwordResetTokenHash: hashed,
        passwordResetTokenExpiresAt: expires,
      } as unknown as Record<string, unknown>);

      const url = `${this.frontendBaseUrl()}/reset-password?token=${encodeURIComponent(rawToken)}`;
      await this.emailService.send({
        to: normalized,
        subject: 'Reset your Iyona password',
        html: `
          <p>Hi,</p>
          <p>We received a request to reset your Iyona password.</p>
          <p><a href="${url}">Click here to set a new password</a>. This link expires in 1 hour.</p>
          <p>If you didn't request this, you can safely ignore this email.</p>
        `,
        text: `Reset your Iyona password: ${url}\n(This link expires in 1 hour. Ignore this email if you didn't request it.)`,
      });
    } catch (error) {
      // Never surface provider errors to the client.
      logAndThrowError('error in requestPasswordReset', error);
    }
  }

  /**
   * Consume a password-reset token and set a new password. Throws on
   * invalid / expired tokens.
   */
  async resetPassword(token: string, newPassword: string): Promise<void> {
    if (!token || !newPassword) {
      throw new BadRequestException('Missing token or password');
    }
    const hashed = this.hashToken(token);
    const [user] = await this.userHelper.findUserWithSchema({
      passwordResetTokenHash: hashed,
    } as unknown as Parameters<typeof this.userHelper.findUserWithSchema>[0]);
    if (
      !user ||
      user.isDeleted ||
      !user.passwordResetTokenExpiresAt ||
      new Date(user.passwordResetTokenExpiresAt).getTime() < Date.now()
    ) {
      throw new BadRequestException('Invalid or expired reset token');
    }

    const newHash = await this.passwordService.hash(newPassword);
    await this.userHelper.updateUser({ _id: user._id }, {
      password: newHash,
      passwordResetTokenHash: null,
      passwordResetTokenExpiresAt: null,
      sessionIds: [],
    } as unknown as Record<string, unknown>);
  }

  /**
   * Re-issue a verification token and email it. Silent for unknown emails.
   */
  async resendVerificationEmail(email: string): Promise<void> {
    const normalized = (email || '').trim().toLowerCase();
    const [user] = await this.userHelper.findUserWithSchema({
      email: normalized,
    });
    if (!user || user.isDeleted || user.isVerified) {
      return;
    }
    const verificationToken = randomBytes(32).toString('hex');
    await this.userHelper.updateUser({ _id: user._id }, {
      verificationToken,
    } as unknown as Record<string, unknown>);

    const url = `${this.frontendBaseUrl()}/verify-email?token=${encodeURIComponent(verificationToken)}&email=${encodeURIComponent(normalized)}`;
    await this.emailService.send({
      to: normalized,
      subject: 'Verify your Iyona email',
      html: `
        <p>Welcome to Iyona!</p>
        <p><a href="${url}">Click here to verify your email address</a>.</p>
      `,
      text: `Verify your Iyona email: ${url}`,
    });
  }

  /**
   * Consume a verification token — marks the user verified and clears the
   * token. Throws on mismatch.
   */
  async verifyEmail(token: string, email?: string): Promise<void> {
    if (!token) throw new BadRequestException('Missing token');
    const filter: Record<string, unknown> = { verificationToken: token };
    if (email) filter.email = email.trim().toLowerCase();
    const [user] = await this.userHelper.findUserWithSchema(
      filter as unknown as Parameters<
        typeof this.userHelper.findUserWithSchema
      >[0],
    );
    if (!user || user.isDeleted) {
      throw new BadRequestException('Invalid verification token');
    }
    if (user.isVerified) {
      return;
    }
    await this.userHelper.updateUser({ _id: user._id }, {
      isVerified: true,
      verificationToken: null,
    } as unknown as Record<string, unknown>);
  }

  async signUpUser(dto: CreateUserDto): Promise<UserDto> {
    try {
      const [userExist] = await this.userHelper.findUserWithSchema({
        email: dto.email,
      });
      if (userExist) {
        if (userExist.isVerified) {
          throw new BadRequestException('User is already signed up');
        }
      }
      let createUser: UserDto;
      let signupWelcomeGranted = 0;

      const hashedPassword = await this.passwordService.hash(dto.password);

      if (!userExist) {
        createUser = await this.userHelper.createUser({
          ...dto,
          password: hashedPassword,
          isVerified: true,
        });
        signupWelcomeGranted = await this.tryGrantSignupWelcomeBonus(
          String(createUser._id),
        );
      } else {
        createUser = await this.userHelper.updateUser(
          {
            _id: userExist._id,
          },
          {
            ...dto,
            password: hashedPassword,
            isDeleted: false,
            isVerified: true,
          },
        );
      }
      const { refreshToken, accessToken, uniqueId } =
        await this.authHelper.generateTokens({
          userId: createUser._id,
          role: createUser.role,
          email: createUser.email,
        });
      await this.userHelper.pushSessionId({
        _id: createUser._id,
        sessionId: uniqueId,
      });
      createUser = plainToInstance(UserDto, {
        ...createUser,
        accessToken,
        refreshToken,
        ...(signupWelcomeGranted > 0
          ? { signupBonusCredits: signupWelcomeGranted }
          : {}),
      });
      return createUser;
    } catch (error) {
      throw logAndThrowError('error in signUpUser', error);
    }
  }

  async loginUser(dto: LoginUserDto): Promise<UserDto> {
    try {
      const [userExist] = await this.userHelper.findUserWithSchema({
        email: dto.email,
      });
      if (!userExist) {
        throw new BadRequestException('email is incorrect');
      }
      if (!userExist.isVerified) {
        throw new BadRequestException('user is not verified');
      }
      if (userExist.isDeleted) {
        throw new BadRequestException('user is deleted');
      }
      if (!userExist.password) {
        throw new BadRequestException(
          'please reset your password for manual login',
        );
      }

      const { valid, needsRehash } = await this.passwordService.verify(
        dto.password,
        userExist.password,
      );
      if (!valid) {
        throw new BadRequestException('password is incorrect');
      }

      // Opportunistic migration: legacy AES-encrypted passwords get replaced
      // with a bcrypt hash on first successful login.
      if (needsRehash) {
        try {
          const newHash = await this.passwordService.hash(dto.password);
          await this.userHelper.updateUser(
            { _id: userExist._id },
            { password: newHash },
          );
        } catch (_err) {
          // Rehash failure shouldn't block the login. The next successful
          // login will try again.
        }
      }
      const { refreshToken, accessToken, uniqueId } =
        await this.authHelper.generateTokens({
          userId: userExist._id.toString(),
          role: userExist.role,
          email: userExist.email,
        });
      await this.userHelper.pushSessionId({
        _id: userExist._id.toString(),
        sessionId: uniqueId,
      });
      await this.userHelper.updateUser({ _id: userExist._id }, {
        lastLoginAt: new Date(),
      } as any);
      const [dtoUser] = await this.userHelper.findUser({
        email: userExist.email,
      });
      const userDtoUser = plainToInstance(UserDto, {
        ...dtoUser,
        accessToken: accessToken,
        refreshToken: refreshToken,
      });
      return userDtoUser;
    } catch (error) {
      throw logAndThrowError('error in loginUser', error);
    }
  }

  async logout(refreshToken: string): Promise<void> {
    try {
      const decoded = await this.authHelper.decodeToken(refreshToken);

      const [user] = await this.userHelper.findUserWithSchema({
        _id: new mongoose.Types.ObjectId(decoded.userId),
      });
      const sessionIds = Array.isArray(user?.sessionIds) ? user.sessionIds : [];
      if (
        !user ||
        !decoded.uniqueId ||
        !sessionIds.includes(decoded.uniqueId)
      ) {
        throw new UnauthorizedException('Invalid refresh token');
      }

      await this.userHelper.removeSessionId({
        _id: String(user._id),
        sessionId: decoded.uniqueId,
      });

      return;
    } catch (error) {
      throw logAndThrowError('error in logout', error);
    }
  }

  // refreshToken
  async refreshToken(
    refreshToken: string,
  ): Promise<{ data: { accessToken: string; refreshToken: string } }> {
    try {
      // Validate refresh token format
      if (!refreshToken || typeof refreshToken !== 'string') {
        throw new UnauthorizedException('Invalid refresh token format');
      }

      // Decode refresh token
      let decoded;
      try {
        decoded = await this.authHelper.decodeToken(refreshToken);
      } catch {
        throw new UnauthorizedException('Invalid or expired refresh token');
      }

      // Find user
      const [user] = await this.userHelper.findUserWithSchema({
        _id: new mongoose.Types.ObjectId(decoded.userId),
      });

      if (!user) {
        throw new UnauthorizedException('User not found');
      }

      // Check if user is active
      if (!user.isVerified) {
        throw new UnauthorizedException('User is not verified');
      }

      if (user.isDeleted) {
        throw new UnauthorizedException('User account is deleted');
      }

      // Validate that the refresh token's session id is still on the user.
      const sessionIds = Array.isArray(user.sessionIds) ? user.sessionIds : [];
      if (!decoded.uniqueId || !sessionIds.includes(decoded.uniqueId)) {
        throw new UnauthorizedException('Invalid refresh token');
      }

      const userId = user._id.toString();

      const {
        accessToken,
        refreshToken: newRefreshToken,
        uniqueId: newUniqueId,
      } = await this.authHelper.generateTokens({
        userId,
        role: user.role,
        email: user.email,
      });

      // Atomic rotate: single write that removes the old session id, appends
      // the new one, and trims back to the FIFO cap. If the old id disappeared
      // (e.g., race with another rotation) this returns null and we reject.
      const rotated = await this.userHelper.rotateSessionId({
        _id: userId,
        oldSessionId: decoded.uniqueId,
        newSessionId: newUniqueId,
      });
      if (!rotated) {
        throw new UnauthorizedException('Session was revoked during refresh');
      }

      return { data: { accessToken, refreshToken: newRefreshToken } };
    } catch (error) {
      // Log the error for debugging
      console.error('Refresh token error:', error.message);

      // Re-throw the error
      throw error;
    }
  }

  /**
   * Issue an HMAC-signed, single-use nonce that OAuth clients can round-trip
   * through the IdP as the `state` parameter. The backend verifies the same
   * HMAC on callback, which is what prevents cross-session replay and basic
   * CSRF against the OAuth login endpoints.
   *
   * Payload format: `<nonce>.<issuedAtMs>.<hmac>` (base64url), TTL 10 minutes.
   */
  issueOAuthState(): { state: string; expiresAt: number } {
    const secret = this.getOAuthStateSecret();
    const nonce = randomBytes(24).toString('base64url');
    const issuedAt = Date.now();
    const body = `${nonce}.${issuedAt}`;
    const hmac = createHmac('sha256', secret).update(body).digest('base64url');
    return {
      state: `${body}.${hmac}`,
      expiresAt: issuedAt + AuthService.OAUTH_STATE_TTL_MS,
    };
  }

  private verifyOAuthState(state: string | undefined): void {
    const required = process.env.OAUTH_STATE_REQUIRED === 'true';
    if (!state) {
      if (required) {
        throw new BadRequestException(
          'OAuth state nonce is required — call POST /auth/oauth/state first',
        );
      }
      return;
    }

    const parts = state.split('.');
    if (parts.length !== 3) {
      throw new BadRequestException('Malformed OAuth state');
    }
    const [nonce, issuedAtStr, providedHmac] = parts;
    const issuedAt = Number(issuedAtStr);
    if (!Number.isFinite(issuedAt)) {
      throw new BadRequestException('Malformed OAuth state');
    }
    if (Date.now() - issuedAt > AuthService.OAUTH_STATE_TTL_MS) {
      throw new BadRequestException('OAuth state expired');
    }

    const secret = this.getOAuthStateSecret();
    const expectedHmac = createHmac('sha256', secret)
      .update(`${nonce}.${issuedAt}`)
      .digest('base64url');

    const a = Buffer.from(providedHmac);
    const b = Buffer.from(expectedHmac);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new BadRequestException('Invalid OAuth state signature');
    }
  }

  private getOAuthStateSecret(): string {
    const secret = process.env.OAUTH_STATE_SECRET || process.env.JWT_SECRET;
    if (!secret) {
      throw new Error(
        'OAUTH_STATE_SECRET (or JWT_SECRET fallback) must be set',
      );
    }
    return secret;
  }

  private static readonly OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

  async googleLogin(accessToken: string, state?: string): Promise<UserDto> {
    this.verifyOAuthState(state);
    try {
      // Before trusting the userinfo endpoint we must confirm this access
      // token was issued for *our* OAuth client. Otherwise a token from any
      // other Google app would pass login and potentially take over accounts
      // with the same email address.
      const expectedAudience = process.env.GOOGLE_CLIENT_ID;
      if (!expectedAudience) {
        throw new BadRequestException(
          'Google OAuth is not configured on the server',
        );
      }

      try {
        const tokenInfoResp = await axios.get(
          'https://oauth2.googleapis.com/tokeninfo',
          { params: { access_token: accessToken } },
        );
        const tokenInfo = tokenInfoResp.data as {
          aud?: string;
          azp?: string;
          error_description?: string;
        };
        const aud = tokenInfo.aud || tokenInfo.azp;
        if (!aud || aud !== expectedAudience) {
          throw new BadRequestException(
            'Google access token audience does not match this application',
          );
        }
      } catch (error) {
        if (error instanceof BadRequestException) throw error;
        throw new BadRequestException('Invalid Google access token');
      }

      // Verify token and get user info from Google
      const response = await axios.get(
        `https://www.googleapis.com/oauth2/v2/userinfo`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        },
      );

      const googleUser = response.data;

      if (!googleUser.email) {
        throw new BadRequestException('Email not found in Google account');
      }

      if (googleUser.verified_email === false) {
        throw new BadRequestException('Google email is not verified');
      }

      // Check if user exists
      const [existingUser] = await this.userHelper.findUserWithSchema({
        email: googleUser.email,
      });

      let user: UserDto;
      let signupWelcomeGranted = 0;

      if (existingUser) {
        // Silent "reactivation" on OAuth is a footgun: admin-deleted accounts
        // would resurrect themselves the moment the user re-authorizes. Fail
        // closed and force an explicit restore flow instead.
        if (existingUser.isDeleted) {
          throw new BadRequestException(
            'This account has been deactivated. Please contact support to restore it.',
          );
        }
        const [dtoUser] = await this.userHelper.findUser({
          email: googleUser.email,
        });
        user = dtoUser;
      } else {
        // OAuth users never use their password; store a random bcrypt hash
        // so nothing can "log in" with password against this account.
        const randomPassword = randomBytes(32).toString('hex');
        user = await this.userHelper.createUser({
          email: googleUser.email,
          password: await this.passwordService.hash(randomPassword),
          isVerified: true,
        });
        signupWelcomeGranted = await this.tryGrantSignupWelcomeBonus(
          String(user._id),
        );
      }

      const {
        refreshToken: newRefreshToken,
        accessToken: newAccessToken,
        uniqueId,
      } = await this.authHelper.generateTokens({
        userId: user._id,
        role: user.role,
        email: user.email,
      });

      await this.userHelper.pushSessionId({
        _id: user._id,
        sessionId: uniqueId,
      });
      await this.userHelper.updateUser({ _id: user._id }, {
        lastLoginAt: new Date(),
      } as any);

      return plainToInstance(UserDto, {
        ...user,
        accessToken: newAccessToken,
        refreshToken: newRefreshToken,
        ...(signupWelcomeGranted > 0
          ? { signupBonusCredits: signupWelcomeGranted }
          : {}),
      });
    } catch (error) {
      if (error.response?.status === 401) {
        throw new UnauthorizedException('Invalid Google access token');
      }
      throw logAndThrowError('error in googleLogin', error);
    }
  }

  private async exchangeGithubCode(code: string): Promise<string> {
    const clientId = process.env.GITHUB_CLIENT_ID;
    const clientSecret = process.env.GITHUB_CLIENT_SECRET;
    const redirectUri =
      process.env.GITHUB_REDIRECT_URI ||
      process.env.GITHUB_INTEGRATION_REDIRECT_URI;

    if (!clientId || !clientSecret) {
      throw new BadRequestException(
        'GitHub OAuth is not configured on the server',
      );
    }

    try {
      const { data } = await axios.post(
        'https://github.com/login/oauth/access_token',
        {
          client_id: clientId,
          client_secret: clientSecret,
          code,
          ...(redirectUri ? { redirect_uri: redirectUri } : {}),
        },
        { headers: { Accept: 'application/json' } },
      );

      if (data.error || !data.access_token) {
        throw new BadRequestException(
          data.error_description || data.error || 'GitHub code exchange failed',
        );
      }

      return data.access_token as string;
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw logAndThrowError('error in exchangeGithubCode', error);
    }
  }

  async githubLogin(input: { code: string; state?: string }): Promise<UserDto> {
    try {
      this.verifyOAuthState(input.state);

      if (!input.code) {
        throw new BadRequestException('`code` is required for GitHub login');
      }

      // Only the `code` path is accepted: the client secret never leaves the
      // backend, and there's no way for a malicious caller to hand us a token
      // issued to a different OAuth app.
      const accessToken = await this.exchangeGithubCode(input.code);

      await axios.get(`https://api.github.com/user`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/vnd.github.v3+json',
        },
      });

      // Always fetch from the emails endpoint: the single `user.email` field
      // can be a no-reply alias or unverified address, both of which would
      // let an attacker register as an arbitrary email they don't own.
      let email: string | undefined;
      try {
        const emailsResponse = await axios.get(
          `https://api.github.com/user/emails`,
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              Accept: 'application/vnd.github.v3+json',
            },
          },
        );
        const emails = Array.isArray(emailsResponse.data)
          ? emailsResponse.data
          : [];
        const primaryVerified = emails.find(
          (e: any) => e?.primary === true && e?.verified === true,
        );
        email = primaryVerified?.email;
      } catch (_emailError) {
        throw new BadRequestException(
          'Could not read GitHub emails. Grant the `user:email` scope and try again.',
        );
      }

      if (!email) {
        throw new BadRequestException(
          'Your GitHub account does not have a verified primary email.',
        );
      }

      const [existingUser] = await this.userHelper.findUserWithSchema({
        email: email,
      });

      let user: UserDto;
      let signupWelcomeGranted = 0;

      if (existingUser) {
        if (existingUser.isDeleted) {
          throw new BadRequestException(
            'This account has been deactivated. Please contact support to restore it.',
          );
        }
        const [dtoUser] = await this.userHelper.findUser({
          email: email,
        });
        user = dtoUser;
      } else {
        // OAuth users never use their password; store a random bcrypt hash.
        const randomPassword = randomBytes(32).toString('hex');
        user = await this.userHelper.createUser({
          email: email,
          password: await this.passwordService.hash(randomPassword),
          isVerified: true,
          githubConnected: true, // Set to true when signing up with GitHub
        });
        signupWelcomeGranted = await this.tryGrantSignupWelcomeBonus(
          String(user._id),
        );
      }

      // Update githubConnected if user exists but wasn't set
      if (existingUser && !existingUser.githubConnected) {
        user = await this.userHelper.updateUser(
          { _id: existingUser._id },
          { githubConnected: true },
        );
      }

      const {
        refreshToken: newRefreshToken,
        accessToken: newAccessToken,
        uniqueId,
      } = await this.authHelper.generateTokens({
        userId: user._id,
        role: user.role,
        email: user.email,
      });

      await this.userHelper.pushSessionId({
        _id: user._id,
        sessionId: uniqueId,
      });
      await this.userHelper.updateUser({ _id: user._id }, {
        lastLoginAt: new Date(),
      } as any);

      return plainToInstance(UserDto, {
        ...user,
        accessToken: newAccessToken,
        refreshToken: newRefreshToken,
        ...(signupWelcomeGranted > 0
          ? { signupBonusCredits: signupWelcomeGranted }
          : {}),
      });
    } catch (error) {
      if (error.response?.status === 401) {
        throw new UnauthorizedException('Invalid GitHub access token');
      }
      throw logAndThrowError('error in githubLogin', error);
    }
  }
}
