import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createHmac,
  randomInt,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import type { Env } from '../../../config/env.js';
import type { VerificationPurpose } from '../../../generated/prisma/enums.js';
import {
  ConflictError,
  InvalidInputError,
} from '../../../shared/domain/domain-error.js';
import {
  type Db,
  PrismaService,
} from '../../../shared/database/prisma.service.js';

export const CODE_TTL_MINUTES = 10;
const RESEND_COOLDOWN_SECONDS = 60;
const MAX_ATTEMPTS = 5;

/**
 * One-time 6-digit codes. Stored as an HMAC keyed with the server secret and
 * salted with the row id, so a database leak doesn't reveal live codes.
 */
@Injectable()
export class VerificationCodes {
  private readonly key: string;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService<Env, true>,
  ) {
    this.key = config.get('JWT_SECRET', { infer: true });
  }

  /** Creates a new code (superseding older ones) and returns it for delivery. */
  async issue(
    userId: string,
    purpose: VerificationPurpose,
    target: string,
    db: Db = this.prisma,
  ): Promise<string> {
    const latest = await db.verificationCode.findFirst({
      where: { userId, purpose },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    if (latest) {
      const wait =
        RESEND_COOLDOWN_SECONDS -
        Math.floor((Date.now() - latest.createdAt.getTime()) / 1000);
      if (wait > 0) {
        throw new ConflictError(
          'code_cooldown',
          `Wait ${wait} seconds before asking for another code`,
        );
      }
    }

    const id = randomUUID();
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    await db.verificationCode.updateMany({
      where: { userId, purpose, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    await db.verificationCode.create({
      data: {
        id,
        userId,
        purpose,
        target,
        codeHash: this.hash(id, code),
        expiresAt: new Date(Date.now() + CODE_TTL_MINUTES * 60_000),
      },
    });
    return code;
  }

  /**
   * Checks and consumes the current code; returns the target it was sent to.
   * Don't call inside a transaction that the wrong-code error would roll
   * back, or failed attempts won't be counted.
   */
  async consume(
    userId: string,
    purpose: VerificationPurpose,
    code: string,
  ): Promise<string> {
    const db = this.prisma;
    const current = await db.verificationCode.findFirst({
      where: { userId, purpose, consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    const invalid = new InvalidInputError(
      'invalid_code',
      "That code isn't right or has expired. Ask for a new one.",
    );
    if (
      !current ||
      current.expiresAt < new Date() ||
      current.attempts >= MAX_ATTEMPTS
    )
      throw invalid;

    const expected = Buffer.from(current.codeHash, 'hex');
    const actual = Buffer.from(this.hash(current.id, code.trim()), 'hex');
    if (!timingSafeEqual(expected, actual)) {
      await db.verificationCode.update({
        where: { id: current.id },
        data: { attempts: { increment: 1 } },
      });
      throw invalid;
    }
    // Conditional update so two concurrent submissions can't both succeed
    const { count } = await db.verificationCode.updateMany({
      where: { id: current.id, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    if (count === 0) throw invalid;
    return current.target;
  }

  private hash(id: string, code: string): string {
    return createHmac('sha256', this.key).update(`${id}:${code}`).digest('hex');
  }
}
