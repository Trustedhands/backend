import { Injectable, Logger } from '@nestjs/common';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  ACCESS_TOKEN_TTL_SECONDS,
  AccessTokens,
} from '../../../shared/auth/access-tokens.js';
import { UnauthorizedError } from '../../../shared/domain/domain-error.js';
import {
  type Db,
  PrismaService,
} from '../../../shared/database/prisma.service.js';

export const REFRESH_TOKEN_TTL_DAYS = 30;

export interface IssuedSession {
  accessToken: string;
  /** Seconds until the access token expires */
  expiresIn: number;
  refreshToken: string;
  refreshExpiresAt: Date;
}

const sha256 = (token: string) =>
  createHash('sha256').update(token).digest('hex');

/**
 * Access + refresh token pairs. Refresh tokens rotate on every use; presenting
 * an already-rotated token revokes its whole family, since it means two
 * parties hold copies of it.
 */
@Injectable()
export class Sessions {
  private readonly logger = new Logger(Sessions.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly accessTokens: AccessTokens,
  ) {}

  async start(
    userId: string,
    userAgent: string | null,
    db: Db = this.prisma,
  ): Promise<IssuedSession> {
    return this.issue(userId, randomUUID(), userAgent, db);
  }

  async refresh(
    refreshToken: string,
    userAgent: string | null,
  ): Promise<IssuedSession> {
    const outcome = await this.prisma.$transaction(async (tx) => {
      const current = await tx.refreshToken.findUnique({
        where: { tokenHash: sha256(refreshToken) },
      });
      if (!current || current.revokedAt || current.expiresAt < new Date())
        return { kind: 'invalid' as const };

      const { count } = await tx.refreshToken.updateMany({
        where: { id: current.id, usedAt: null, revokedAt: null },
        data: { usedAt: new Date() },
      });
      if (count === 0)
        return {
          kind: 'reused' as const,
          familyId: current.familyId,
          userId: current.userId,
        };
      return {
        kind: 'ok' as const,
        session: await this.issue(
          current.userId,
          current.familyId,
          userAgent,
          tx,
        ),
      };
    });

    if (outcome.kind === 'ok') return outcome.session;
    if (outcome.kind === 'reused') {
      this.logger.warn(
        `Refresh token reuse for user ${outcome.userId}; revoking the session family`,
      );
      await this.revokeFamily(outcome.familyId);
    }
    throw new UnauthorizedError(
      'session_expired',
      'Your session has expired. Log in again.',
    );
  }

  /** Logout: ends this device's session. */
  async end(refreshToken: string): Promise<void> {
    const current = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: sha256(refreshToken) },
    });
    if (current) await this.revokeFamily(current.familyId);
  }

  /** Signs the user out everywhere (password change/reset). */
  async endAll(userId: string, db: Db = this.prisma): Promise<void> {
    await db.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async revokeFamily(familyId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async issue(
    userId: string,
    familyId: string,
    userAgent: string | null,
    db: Db,
  ): Promise<IssuedSession> {
    const refreshToken = randomBytes(32).toString('base64url');
    const refreshExpiresAt = new Date(
      Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
    );
    await db.user.update({
      where: { id: userId },
      data: { lastActiveAt: new Date() },
    });
    await db.refreshToken.create({
      data: {
        userId,
        familyId,
        tokenHash: sha256(refreshToken),
        expiresAt: refreshExpiresAt,
        userAgent: userAgent?.slice(0, 300) ?? null,
      },
    });
    return {
      accessToken: await this.accessTokens.sign(userId),
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
      refreshToken,
      refreshExpiresAt,
    };
  }
}
