import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import type {
  WalletEntry,
  WalletTopUp,
} from '../../../generated/prisma/client.js';
import type { Env } from '../../../config/env.js';
import { AuditLog } from '../../../shared/audit/audit-log.js';
import {
  NotFoundError,
  UnavailableError,
} from '../../../shared/domain/domain-error.js';
import {
  type Db,
  PrismaService,
} from '../../../shared/database/prisma.service.js';
import { formatRequestRef } from '../../../shared/http/references.js';
import { ConfigurationService } from '../../configuration/application/configuration.service.js';
import { maskMsisdn, normalizeMsisdn } from '../domain/msisdn.js';
import {
  assertWalletAmount,
  walletEntryLabel,
  type WalletEntryType,
} from '../domain/wallet.js';
import type {
  ClientWalletEntryView,
  ClientWalletView,
  WalletTopUpView,
} from '../presentation/wallet.views.js';
import {
  MobileMoneyGateway,
  PaymentRejectedError,
} from './mobile-money.gateway.js';

/** How long MoMo may report "no such request" before we treat the top-up as failed. */
const NOT_FOUND_GRACE_MS = 5 * 60_000;

/** Serialises wallet changes for one client (balance checks, debits). */
export async function lockWallet(tx: Db, profileId: string): Promise<void> {
  await tx.$executeRaw`select 1 from app.profiles where id = ${profileId}::uuid for update`;
}

export async function walletBalance(db: Db, profileId: string) {
  const sum = await db.walletEntry.aggregate({
    where: { profileId },
    _sum: { amountRwf: true },
  });
  return sum._sum.amountRwf ?? 0;
}

/**
 * The client wallet: an append-only list of entries whose sum is the balance.
 * Money comes in from MoMo top-ups, ops credits and refunds of wallet
 * payments, and goes out when the client pays a booking from it.
 */
@Injectable()
export class WalletService {
  private readonly logger = new Logger(WalletService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: MobileMoneyGateway,
    private readonly settings: ConfigurationService,
    private readonly audit: AuditLog,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async view(profileId: string): Promise<ClientWalletView> {
    const [balanceRwf, entries, pending] = await Promise.all([
      walletBalance(this.prisma, profileId),
      this.prisma.walletEntry.findMany({
        where: { profileId },
        orderBy: { createdAt: 'desc' },
        take: 100,
        include: {
          payment: { select: { serviceRequest: { select: { number: true } } } },
          refund: {
            select: {
              payment: {
                select: { serviceRequest: { select: { number: true } } },
              },
            },
          },
        },
      }),
      this.prisma.walletTopUp.findMany({
        where: { profileId, status: 'PENDING' },
        orderBy: { createdAt: 'desc' },
      }),
    ]);
    const staff = await this.names(entries.map((e) => e.createdById));
    return {
      balanceRwf,
      enabled: (await this.settings.settings()).clientWalletEnabled,
      pendingTopUps: pending.map(toTopUpView),
      entries: entries.map((e) => toEntryView(e, staff)),
    };
  }

  /** Client top-up: sends a MoMo prompt; poll GET /wallet/top-ups/:id. */
  async startTopUp(
    profileId: string,
    amountRwf: number,
    rawMsisdn: string,
  ): Promise<WalletTopUpView> {
    assertWalletAmount(amountRwf);
    const strict =
      this.config.get('MOMO_TARGET_ENVIRONMENT', { infer: true }) !== 'sandbox';
    const msisdn = normalizeMsisdn(rawMsisdn, strict);
    const settings = await this.settings.settings();
    if (!settings.clientWalletEnabled) {
      throw new UnavailableError(
        'wallet_disabled',
        "Wallet top-ups aren't available right now",
      );
    }
    if (!settings.momoEnabled) {
      throw new UnavailableError(
        'payments_paused',
        'Mobile Money payments are paused right now. Please try again later.',
      );
    }

    const outcome = await this.prisma.$transaction(async (tx) => {
      await lockWallet(tx, profileId);
      // One prompt on the phone at a time
      const pending = await tx.walletTopUp.findFirst({
        where: { profileId, status: 'PENDING' },
      });
      if (pending) return { topUp: pending, created: false };
      const topUp = await tx.walletTopUp.create({
        data: {
          profileId,
          amountRwf,
          msisdn,
          providerReference: randomUUID(),
        },
      });
      return { topUp, created: true };
    });
    if (!outcome.created) return toTopUpView(await this.sync(outcome.topUp));

    const { topUp } = outcome;
    try {
      await this.gateway.requestToPay({
        referenceId: topUp.providerReference,
        amount: topUp.amountRwf,
        msisdn,
        externalId: topUp.id,
        message: 'TrustedHands wallet top-up',
      });
    } catch (error) {
      const notConfigured =
        (error as { code?: string })?.code === 'momo_not_configured';
      if (error instanceof PaymentRejectedError || notConfigured) {
        await this.settle(topUp, {
          status: 'FAILED',
          reason:
            error instanceof Error ? error.message : 'Top-up request rejected',
        });
        if (notConfigured) throw error;
      } else {
        // Timeouts and 5xx are ambiguous; status checks will settle it
        this.logger.warn(
          `requesttopay outcome unknown for top-up ${topUp.id}: ${String(error)}`,
        );
      }
    }
    return this.topUp(profileId, topUp.id);
  }

  /** Also refreshes the status from MoMo while PENDING. */
  async topUp(profileId: string, id: string): Promise<WalletTopUpView> {
    const row = await this.prisma.walletTopUp.findUnique({ where: { id } });
    if (!row || row.profileId !== profileId) {
      throw new NotFoundError('top_up_not_found', 'Top-up not found');
    }
    return toTopUpView(await this.sync(row));
  }

  /** MoMo callback (shares MOMO_CALLBACK_URL with payments); only a prompt to check. */
  async handleProviderCallback(id: string): Promise<void> {
    await this.syncById(id);
  }

  /** Used by the settlement job for top-ups nobody is polling. */
  async syncById(id: string): Promise<void> {
    const row = await this.prisma.walletTopUp.findUnique({ where: { id } });
    if (row) await this.sync(row);
  }

  /** Ops credit, e.g. cash or a bank transfer received, or a goodwill gesture. */
  async credit(
    actorId: string,
    profileId: string,
    amountRwf: number,
    note: string,
  ): Promise<ClientWalletView> {
    assertWalletAmount(amountRwf);
    const client = await this.prisma.profile.findFirst({
      where: { id: profileId, role: 'CLIENT' },
      select: { id: true },
    });
    if (!client)
      throw new NotFoundError('client_not_found', 'Client not found');
    await this.prisma.$transaction(async (tx) => {
      await lockWallet(tx, profileId);
      const entry = await tx.walletEntry.create({
        data: {
          profileId,
          type: 'ADJUSTMENT',
          amountRwf,
          note: note.trim(),
          createdById: actorId,
        },
      });
      await this.audit.record(
        {
          actorId,
          action: 'wallet.credited',
          entityType: 'client',
          entityId: profileId,
          data: { entryId: entry.id, amountRwf, note: note.trim() },
        },
        tx,
      );
    });
    return this.view(profileId);
  }

  private async sync(row: WalletTopUp): Promise<WalletTopUp> {
    if (row.status !== 'PENDING') return row;
    let result;
    try {
      result = await this.gateway.getStatus(row.providerReference);
    } catch (error) {
      this.logger.warn(
        `Status check failed for top-up ${row.id}: ${String(error)}`,
      );
      return row;
    }
    switch (result.status) {
      case 'PENDING':
        return row;
      case 'NOT_FOUND':
        if (Date.now() - row.createdAt.getTime() < NOT_FOUND_GRACE_MS)
          return row;
        await this.settle(row, {
          status: 'FAILED',
          reason: 'MoMo did not receive the top-up request',
        });
        break;
      default:
        await this.settle(row, result);
    }
    return this.prisma.walletTopUp.findUniqueOrThrow({ where: { id: row.id } });
  }

  /** Conditional on still being PENDING, so callback and polling can't both credit it. */
  private async settle(
    row: WalletTopUp,
    outcome:
      | { status: 'SUCCESSFUL'; transactionId: string | null }
      | { status: 'FAILED'; reason: string },
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.walletTopUp.updateMany({
        where: { id: row.id, status: 'PENDING' },
        data:
          outcome.status === 'SUCCESSFUL'
            ? {
                status: 'SUCCESSFUL',
                providerTransactionId: outcome.transactionId,
                completedAt: new Date(),
              }
            : {
                status: 'FAILED',
                failureReason: outcome.reason,
                completedAt: new Date(),
              },
      });
      if (!count || outcome.status !== 'SUCCESSFUL') return;
      await tx.walletEntry.create({
        data: {
          profileId: row.profileId,
          type: 'TOP_UP',
          amountRwf: row.amountRwf,
          topUpId: row.id,
        },
      });
    });
  }

  private async names(ids: Array<string | null>): Promise<Map<string, string>> {
    const unique = [...new Set(ids.filter((i): i is string => Boolean(i)))];
    if (!unique.length) return new Map();
    const rows = await this.prisma.profile.findMany({
      where: { id: { in: unique } },
      select: { id: true, fullName: true },
    });
    return new Map(rows.map((r) => [r.id, r.fullName]));
  }
}

type EntryRow = WalletEntry & {
  payment: { serviceRequest: { number: number } } | null;
  refund: { payment: { serviceRequest: { number: number } } } | null;
};

function toEntryView(
  e: EntryRow,
  staff: Map<string, string>,
): ClientWalletEntryView {
  const number =
    e.payment?.serviceRequest.number ?? e.refund?.payment.serviceRequest.number;
  const reference = number !== undefined ? formatRequestRef(number) : null;
  const type = e.type as WalletEntryType;
  return {
    id: e.id,
    type,
    label: walletEntryLabel(type, reference),
    amountRwf: e.amountRwf,
    serviceRequestReference: reference,
    note: e.note,
    createdByName: e.createdById
      ? (staff.get(e.createdById) ?? 'Former staff')
      : null,
    at: e.createdAt,
  };
}

function toTopUpView(t: WalletTopUp): WalletTopUpView {
  return {
    id: t.id,
    amountRwf: t.amountRwf,
    status: t.status,
    msisdnMasked: maskMsisdn(t.msisdn),
    failureReason: t.failureReason,
    createdAt: t.createdAt,
    completedAt: t.completedAt,
  };
}
