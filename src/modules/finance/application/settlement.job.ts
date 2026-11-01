import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../../config/env.js';
import { PrismaService } from '../../../shared/database/prisma.service.js';
import { ConfigurationService } from '../../configuration/application/configuration.service.js';
import { PaymentsService } from '../../payments/application/payments.service.js';
import { ServiceRequestRepository } from '../../service-requests/domain/service-request.repository.js';
import { releaseDueAt } from '../domain/settlement.js';
import { FinanceService } from './finance.service.js';

const INTERVAL_MS = 60_000;
/** Leave fresh MoMo requests to the client's own polling */
const PENDING_MIN_AGE_MS = 60_000;
const BATCH = 50;

export interface SettlementReport {
  autoCompleted: number;
  released: number;
  paymentsChecked: number;
  transfersChecked: number;
}

/**
 * Runs every minute:
 *  1. completes jobs whose release window passed without client confirmation
 *  2. releases escrow on completed jobs (worker share + platform fee), and on
 *     paid jobs cancelled longer ago than the release window (unrefunded
 *     money goes to the platform)
 *  3. settles MoMo payments, refunds and payouts still pending
 * Every step is idempotent, so overlapping runs or several API instances are safe.
 */
@Injectable()
export class SettlementJob
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(SettlementJob.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly finance: FinanceService,
    private readonly payments: PaymentsService,
    private readonly requests: ServiceRequestRepository,
    private readonly settings: ConfigurationService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  onApplicationBootstrap(): void {
    // Tests drive runOnce() themselves
    if (this.config.get('NODE_ENV', { infer: true }) === 'test') return;
    this.timer = setInterval(() => void this.tick(), INTERVAL_MS);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const report = await this.runOnce();
      if (report.autoCompleted || report.released)
        this.logger.log(`Settlement: ${JSON.stringify(report)}`);
    } catch (error) {
      this.logger.error(`Settlement run failed: ${(error as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  async runOnce(now = new Date()): Promise<SettlementReport> {
    const report: SettlementReport = {
      autoCompleted: 0,
      released: 0,
      paymentsChecked: 0,
      transfersChecked: 0,
    };
    const { releaseAfterHours } = await this.settings.settings();

    // 1. Auto-complete (cheap pre-filter in SQL, exact due time in code)
    const candidates = await this.prisma.serviceRequest.findMany({
      where: {
        status: { in: ['ASSIGNED', 'IN_PROGRESS'] },
        scheduledAt: {
          lt: new Date(now.getTime() - releaseAfterHours * 3_600_000),
        },
      },
      select: { id: true, scheduledAt: true, durationHours: true },
      orderBy: { scheduledAt: 'asc' },
      take: BATCH,
    });
    for (const c of candidates) {
      if (
        releaseDueAt(
          c.scheduledAt,
          c.durationHours?.toNumber() ?? 0,
          releaseAfterHours,
        ) > now
      )
        continue;
      try {
        const request = await this.requests.findById(c.id);
        if (
          !request ||
          (request.status !== 'ASSIGNED' && request.status !== 'IN_PROGRESS')
        )
          continue;
        request.autoComplete(now);
        await this.requests.save(request);
        report.autoCompleted++;
      } catch (error) {
        // e.g. the client completed it at the same moment
        this.logger.warn(
          `Auto-complete ${c.id} skipped: ${(error as Error).message}`,
        );
      }
    }

    // 2. Release
    const toRelease = await this.prisma.serviceRequest.findMany({
      where: { status: 'COMPLETED', releasedAt: null },
      select: { id: true },
      orderBy: { completedAt: 'asc' },
      take: BATCH,
    });
    // Cancelled after payment: what wasn't refunded within the window goes to the platform
    const cancelled = await this.prisma.serviceRequest.findMany({
      where: {
        status: 'CANCELLED',
        releasedAt: null,
        payments: { some: { status: 'SUCCESSFUL' } },
        events: {
          some: {
            status: 'CANCELLED',
            createdAt: {
              lt: new Date(now.getTime() - releaseAfterHours * 3_600_000),
            },
          },
        },
      },
      select: { id: true },
      take: BATCH,
    });
    for (const r of [...toRelease, ...cancelled]) {
      if (await this.finance.release(r.id)) report.released++;
    }

    // 3. Pending MoMo operations
    const stale = new Date(now.getTime() - PENDING_MIN_AGE_MS);
    const [payments, refunds, payouts] = await Promise.all([
      this.prisma.payment.findMany({
        where: { status: 'PENDING', createdAt: { lt: stale } },
        select: { id: true },
        take: BATCH,
      }),
      this.prisma.refund.findMany({
        where: { status: 'PENDING', createdAt: { lt: stale } },
        select: { id: true },
        take: BATCH,
      }),
      this.prisma.payout.findMany({
        where: { status: 'PENDING', method: 'MOMO', createdAt: { lt: stale } },
        select: { id: true },
        take: BATCH,
      }),
    ]);
    for (const p of payments) {
      await this.payments.syncById(p.id);
      report.paymentsChecked++;
    }
    for (const r of refunds) {
      await this.finance.syncRefund(r.id);
      report.transfersChecked++;
    }
    for (const p of payouts) {
      await this.finance.syncPayout(p.id);
      report.transfersChecked++;
    }
    return report;
  }
}
