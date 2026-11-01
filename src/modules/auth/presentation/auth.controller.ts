import {
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import type { Env } from '../../../config/env.js';
import type { AuthUser } from '../../../shared/auth/auth-user.js';
import { CurrentUser, Public } from '../../../shared/auth/decorators.js';
import { RateLimit, RateLimitGuard } from '../../../shared/http/rate-limit.js';
import { UnauthorizedError } from '../../../shared/domain/domain-error.js';
import { AuthService } from '../application/auth.service.js';
import type { IssuedSession } from '../application/sessions.service.js';
import { Sessions } from '../application/sessions.service.js';
import {
  AuthSessionView,
  ChangePasswordDto,
  ForgotPasswordDto,
  LoginDto,
  RegisterDto,
  ResetPasswordDto,
  SendPhoneCodeDto,
  VerifyCodeDto,
} from './auth.dto.js';
import {
  clearRefreshCookie,
  readRefreshCookie,
  sessionApp,
  setRefreshCookie,
} from './refresh-cookie.js';

/** Tight per-IP limits on credential and code endpoints. */
const STRICT = { limit: 10, ttlMs: 60_000 };

@ApiTags('auth')
@ApiQuery({
  name: 'app',
  required: false,
  enum: ['client', 'admin'],
  description: "Which app's refresh cookie to use (default client)",
})
@UseGuards(RateLimitGuard)
@Controller('auth')
export class AuthController {
  private readonly secureCookies: boolean;
  private readonly allowedOrigins: Set<string>;

  constructor(
    private readonly auth: AuthService,
    private readonly sessions: Sessions,
    config: ConfigService<Env, true>,
  ) {
    this.secureCookies =
      config.get('NODE_ENV', { infer: true }) === 'production';
    this.allowedOrigins = new Set(
      config
        .get('CORS_ORIGINS', { infer: true })
        .split(',')
        .map((o) => o.trim())
        .filter(Boolean),
    );
  }

  /** Creates the account and client profile, emails a verification code, and signs in. */
  @Public()
  @RateLimit(STRICT)
  @Post('register')
  async register(
    @Body() dto: RegisterDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthSessionView> {
    return this.respond(
      req,
      res,
      await this.auth.register(dto, userAgent(req)),
    );
  }

  @Public()
  @RateLimit(STRICT)
  @Post('login')
  @HttpCode(200)
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthSessionView> {
    return this.respond(
      req,
      res,
      await this.auth.login(dto.email, dto.password, userAgent(req)),
    );
  }

  /** Exchanges the refresh cookie for a new access token (and rotates the cookie). */
  @Public()
  @RateLimit({ limit: 30, ttlMs: 60_000 })
  @Post('refresh')
  @HttpCode(200)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthSessionView> {
    this.assertTrustedOrigin(req);
    const token = readRefreshCookie(req, sessionApp(req));
    if (!token)
      throw new UnauthorizedError(
        'session_expired',
        'Your session has expired. Log in again.',
      );
    try {
      return this.respond(
        req,
        res,
        await this.sessions.refresh(token, userAgent(req)),
      );
    } catch (error) {
      clearRefreshCookie(res, sessionApp(req), { secure: this.secureCookies });
      throw error;
    }
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    this.assertTrustedOrigin(req);
    const token = readRefreshCookie(req, sessionApp(req));
    if (token) await this.sessions.end(token);
    clearRefreshCookie(res, sessionApp(req), { secure: this.secureCookies });
  }

  /** Always 202, whether or not the email has an account. */
  @Public()
  @RateLimit(STRICT)
  @Post('password/forgot')
  @HttpCode(202)
  async forgotPassword(@Body() dto: ForgotPasswordDto): Promise<void> {
    await this.auth.requestPasswordReset(dto.email);
  }

  @Public()
  @RateLimit(STRICT)
  @Post('password/reset')
  @HttpCode(200)
  async resetPassword(
    @Body() dto: ResetPasswordDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthSessionView> {
    return this.respond(
      req,
      res,
      await this.auth.resetPassword(
        dto.email,
        dto.code,
        dto.newPassword,
        userAgent(req),
      ),
    );
  }

  /** Signs out other devices. */
  @ApiBearerAuth()
  @RateLimit(STRICT)
  @Post('password/change')
  @HttpCode(200)
  async changePassword(
    @CurrentUser() user: AuthUser,
    @Body() dto: ChangePasswordDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthSessionView> {
    return this.respond(
      req,
      res,
      await this.auth.changePassword(
        user.id,
        dto.currentPassword,
        dto.newPassword,
        userAgent(req),
      ),
    );
  }

  @ApiBearerAuth()
  @RateLimit(STRICT)
  @Post('email/send-code')
  @HttpCode(204)
  async sendEmailCode(@CurrentUser() user: AuthUser): Promise<void> {
    await this.auth.sendEmailCode(user.id);
  }

  @ApiBearerAuth()
  @RateLimit(STRICT)
  @Post('email/verify')
  @HttpCode(204)
  async verifyEmail(
    @CurrentUser() user: AuthUser,
    @Body() dto: VerifyCodeDto,
  ): Promise<void> {
    await this.auth.verifyEmail(user.id, dto.code);
  }

  @ApiBearerAuth()
  @RateLimit(STRICT)
  @Post('phone/send-code')
  @HttpCode(204)
  async sendPhoneCode(
    @CurrentUser() user: AuthUser,
    @Body() dto: SendPhoneCodeDto,
  ): Promise<void> {
    await this.auth.sendPhoneCode(user.id, dto.phone);
  }

  @ApiBearerAuth()
  @RateLimit(STRICT)
  @Post('phone/verify')
  @HttpCode(204)
  async verifyPhone(
    @CurrentUser() user: AuthUser,
    @Body() dto: VerifyCodeDto,
  ): Promise<void> {
    await this.auth.verifyPhone(user.id, dto.code);
  }

  private respond(
    req: Request,
    res: Response,
    session: IssuedSession,
  ): AuthSessionView {
    setRefreshCookie(res, sessionApp(req), session, {
      secure: this.secureCookies,
    });
    return { accessToken: session.accessToken, expiresIn: session.expiresIn };
  }

  /**
   * CSRF defence for the cookie-authenticated endpoints. Browsers always send
   * Origin on POST; non-browser clients (no Origin) can't be CSRF'd.
   */
  private assertTrustedOrigin(req: Request): void {
    const origin = req.headers.origin;
    if (origin && !this.allowedOrigins.has(origin)) {
      throw new ForbiddenException('Untrusted origin');
    }
  }
}

const userAgent = (req: Request) => req.headers['user-agent'] ?? null;
