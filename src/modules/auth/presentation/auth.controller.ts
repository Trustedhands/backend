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
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import type { Env } from '../../../config/env.js';
import type { AuthUser } from '../../../shared/auth/auth-user.js';
import { CurrentUser, Public } from '../../../shared/auth/decorators.js';
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
  setRefreshCookie,
} from './refresh-cookie.js';

/** Tight per-IP limits on credential and code endpoints. */
const STRICT = { default: { limit: 10, ttl: 60_000 } };

@ApiTags('auth')
@UseGuards(ThrottlerGuard)
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
  @Throttle(STRICT)
  @Post('register')
  async register(
    @Body() dto: RegisterDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthSessionView> {
    return this.respond(res, await this.auth.register(dto, userAgent(req)));
  }

  @Public()
  @Throttle(STRICT)
  @Post('login')
  @HttpCode(200)
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthSessionView> {
    return this.respond(
      res,
      await this.auth.login(dto.email, dto.password, userAgent(req)),
    );
  }

  /** Exchanges the refresh cookie for a new access token (and rotates the cookie). */
  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('refresh')
  @HttpCode(200)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthSessionView> {
    this.assertTrustedOrigin(req);
    const token = readRefreshCookie(req);
    if (!token)
      throw new UnauthorizedError(
        'session_expired',
        'Your session has expired. Log in again.',
      );
    try {
      return this.respond(
        res,
        await this.sessions.refresh(token, userAgent(req)),
      );
    } catch (error) {
      clearRefreshCookie(res, { secure: this.secureCookies });
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
    const token = readRefreshCookie(req);
    if (token) await this.sessions.end(token);
    clearRefreshCookie(res, { secure: this.secureCookies });
  }

  /** Always 202, whether or not the email has an account. */
  @Public()
  @Throttle(STRICT)
  @Post('password/forgot')
  @HttpCode(202)
  async forgotPassword(@Body() dto: ForgotPasswordDto): Promise<void> {
    await this.auth.requestPasswordReset(dto.email);
  }

  @Public()
  @Throttle(STRICT)
  @Post('password/reset')
  @HttpCode(200)
  async resetPassword(
    @Body() dto: ResetPasswordDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthSessionView> {
    return this.respond(
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
  @Throttle(STRICT)
  @Post('password/change')
  @HttpCode(200)
  async changePassword(
    @CurrentUser() user: AuthUser,
    @Body() dto: ChangePasswordDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthSessionView> {
    return this.respond(
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
  @Throttle(STRICT)
  @Post('email/send-code')
  @HttpCode(204)
  async sendEmailCode(@CurrentUser() user: AuthUser): Promise<void> {
    await this.auth.sendEmailCode(user.id);
  }

  @ApiBearerAuth()
  @Throttle(STRICT)
  @Post('email/verify')
  @HttpCode(204)
  async verifyEmail(
    @CurrentUser() user: AuthUser,
    @Body() dto: VerifyCodeDto,
  ): Promise<void> {
    await this.auth.verifyEmail(user.id, dto.code);
  }

  @ApiBearerAuth()
  @Throttle(STRICT)
  @Post('phone/send-code')
  @HttpCode(204)
  async sendPhoneCode(
    @CurrentUser() user: AuthUser,
    @Body() dto: SendPhoneCodeDto,
  ): Promise<void> {
    await this.auth.sendPhoneCode(user.id, dto.phone);
  }

  @ApiBearerAuth()
  @Throttle(STRICT)
  @Post('phone/verify')
  @HttpCode(204)
  async verifyPhone(
    @CurrentUser() user: AuthUser,
    @Body() dto: VerifyCodeDto,
  ): Promise<void> {
    await this.auth.verifyPhone(user.id, dto.code);
  }

  private respond(res: Response, session: IssuedSession): AuthSessionView {
    setRefreshCookie(res, session, { secure: this.secureCookies });
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
