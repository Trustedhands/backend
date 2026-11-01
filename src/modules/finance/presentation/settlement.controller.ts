import {
  Controller,
  Get,
  Headers,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiExcludeController } from '@nestjs/swagger';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { Env } from '../../../config/env.js';
import { Public } from '../../../shared/auth/decorators.js';
import {
  SettlementJob,
  type SettlementReport,
} from '../application/settlement.job.js';

const digest = (value: string) => createHash('sha256').update(value).digest();

/**
 * Runs one settlement pass on demand, for serverless hosts where the
 * every-minute timer only fires while an instance happens to be warm.
 * Vercel Cron (or any scheduler) calls it with `Authorization: Bearer <CRON_SECRET>`.
 */
@ApiExcludeController()
@Controller('internal/settlement')
export class SettlementController {
  private readonly secret: Buffer | null;

  constructor(
    private readonly job: SettlementJob,
    config: ConfigService<Env, true>,
  ) {
    const secret = config.get('CRON_SECRET', { infer: true });
    this.secret = secret ? digest(secret) : null;
  }

  @Public()
  @Get()
  run(
    @Headers('authorization') authorization?: string,
  ): Promise<SettlementReport> {
    if (!this.secret) throw new NotFoundException();
    const [scheme, token] = authorization?.split(' ') ?? [];
    if (
      scheme?.toLowerCase() !== 'bearer' ||
      !token ||
      !timingSafeEqual(digest(token), this.secret)
    ) {
      throw new UnauthorizedException();
    }
    return this.job.runOnce();
  }
}
