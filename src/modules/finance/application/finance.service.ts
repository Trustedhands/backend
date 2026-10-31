import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type {
  PaymentStatus,
  Payout,
  Prisma,
  Refund,
} from '../../../generated/prisma/client.js';
import { AuditLog } from '../../../shared/audit/audit-log.js';
import {
  ConflictError,
  InvalidInputError,
  NotFoundError,
} from '../../../shared/domain/domain-error.js';
import {
  type Db,
  PrismaService,
} from '../../../shared/database/prisma.service.js';
import {
  formatReceiptRef,
  formatRequestRef,
} from '../../../shared/http/references.js';
import { ledgerBalance, postLedger } from '../../../shared/ledger/ledger.js';
import { PaymentRejectedError } from '../../payments/application/mobile-money.gateway.js';
import { MoneyTransferGateway } from '../../payments/application/money-transfer.gateway.js';
import { maskMsisdn } from '../../payments/domain/msisdn.js';
import {
  assertPayoutAmount,
  assertRefundable,
  refundSource,
  splitEscrow,
} from '../domain/settlement.js';
import type {
  FinanceOverviewView,
  PayoutsView,
  PayoutView,
  RefundView,
  TransactionPageView,
  TransactionRowView,
  WorkerBalanceView,
  WorkerWalletView,
} from '../presentation/finance.dto.js';

/** Kigali is UTC+2 all year. */
const KIGALI_OFFSET_MS = 2 * 3_600_000;
/** How long MoMo may report "no such transfer" before we treat it as failed. */
const NOT_FOUND_GRACE_MS = 5 * 60_000;

/** Refunds that count against a payment: done, or in flight */
const OPEN_REFUND: { in: PaymentStatus[] } = { in: ['PENDING', 'SUCCESSFUL'] };

/** E.164 or bare MSISDN → the digits MoMo wants (2507…). */
const toMsisdn = (phone: string) => phone.replace(/\D/g, '');

/**
 * Escrow, release, refunds and payouts. Every money movement is a ledger
 * entry written in the same transaction as the state change it reflects.
 */
@Injectable()
export class FinanceService {
  private readonly logger = new Logger(FinanceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly transfers: MoneyTransferGateway,
    private readonly audit: AuditLog,
  ) {}

  // ─── Release ─────────────────────────────────────────────────────────────

  /**
   * Splits a completed request's escrow between its worker and the platform.
   * Idempotent: does nothing if already released or not completed.
   */
  async release(serviceRequestId: string): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      await lockRequest(tx, serviceRequestId);
      const request = await tx.serviceRequest.findUnique({
        where: { id: serviceRequestId },
      });
      if (!request || request.status !== 'COMPLETED' || request.releasedAt)
        return false;

      const escrowRwf = await ledgerBalance(tx, {
        account: 'ESCROW',
        serviceRequestId,
      });
      const refunded = await tx.refund.aggregate({
        where: {
          payment: { serviceRequestId },
          chargedTo: 'ESCROW',
          status: OPEN_REFUND,
        },
        _sum: { amountRwf: true },
      });
      const { workerRwf, platformRwf } = splitEscrow({
        escrowRwf,
        workerFeeRwf: request.assignedWorkerId
          ? (request.workerFeeRwf ?? 0)
          : 0,
        refundedRwf: refunded._sum.amountRwf ?? 0,
      });
      await postLedger(tx, [
        {
          account: 'ESCROW',
          kind: 'RELEASED_TO_WORKER',
          amountRwf: -workerRwf,
          serviceRequestId,
        },
        {
          account: 'ESCROW',
          kind: 'RELEASED_TO_PLATFORM',
          amountRwf: -platformRwf,
          serviceRequestId,
        },
        ...(request.assignedWorkerId
          ? [
              {
                account: 'WORKER' as const,
                kind: 'RELEASED_TO_WORKER' as const,
                amountRwf: workerRwf,
                workerId: request.assignedWorkerId,
                serviceRequestId,
              },
            ]
          : []),
        {
          account: 'PLATFORM',
          kind: 'RELEASED_TO_PLATFORM',
          amountRwf: platformRwf,
          serviceRequestId,
        },
      ]);
      await tx.serviceRequest.update({
        where: { id: serviceRequestId },
        data: { releasedAt: new Date() },
      });
      return true;
    });
  }

  // ─── Refunds ─────────────────────────────────────────────────────────────

  /** "Issue refund": sends money back to the payer's MoMo number. */
  async issueRefund(
    actorId: string,
    input: {
      serviceRequestId: string;
      amountRwf: number;
      reason: string;
      ticketId?: string;
    },
  ): Promise<RefundView> {
    const refund = await this.prisma.$transaction(async (tx) => {
      await lockRequest(tx, input.serviceRequestId);
      const request = await tx.serviceRequest.findUnique({
        where: { id: input.serviceRequestId },
      });
      if (!request)
        throw new NotFoundError(
          'service_request_not_found',
          'Request not found',
        );
      const payment = await tx.payment.findFirst({
        where: { serviceRequestId: request.id, status: 'SUCCESSFUL' },
        orderBy: { completedAt: 'desc' },
      });
      if (!payment)
        throw new ConflictError(
          'not_paid',
          'This request has no successful payment to refund',
        );
      if (!payment.msisdn)
        throw new ConflictError(
          'no_payer_number',
          'The payer’s MoMo number is unknown',
        );

      const chargedTo = refundSource(request.releasedAt !== null);
      const already = await tx.refund.aggregate({
        where: { paymentId: payment.id, status: OPEN_REFUND },
        _sum: { amountRwf: true },
      });
      assertRefundable({
        amountRwf: input.amountRwf,
        paidRwf: payment.amountRwf,
        alreadyRefundedRwf: already._sum.amountRwf ?? 0,
        escrowRwf:
          chargedTo === 'ESCROW'
            ? await ledgerBalance(tx, {
                account: 'ESCROW',
                serviceRequestId: request.id,
              })
            : null,
      });

      const created = await tx.refund.create({
        data: {
          paymentId: payment.id,
          amountRwf: input.amountRwf,
          reason: input.reason.trim(),
          issuedById: actorId,
          ticketId: input.ticketId ?? null,
          msisdn: payment.msisdn,
          chargedTo,
          providerReference: randomUUID(),
        },
      });
      // Reserve the money now so it can't be released or refunded twice
      await postLedger(tx, [
        {
          account: chargedTo,
          kind: 'REFUND',
          amountRwf: -input.amountRwf,
          refundId: created.id,
          paymentId: payment.id,
          serviceRequestId: request.id,
        },
      ]);
      await this.audit.record(
        {
          actorId,
          action: 'payment.refund_issued',
          entityType: 'service_request',
          entityId: request.id,
          data: { refundId: created.id, amountRwf: input.amountRwf, chargedTo },
        },
        tx,
      );
      return { ...created, reference: formatRequestRef(request.number) };
    });

    await this.sendTransfer(
      refund,
      'refunds',
      `TrustedHands refund ${refund.reference}`,
    );
    return this.refundView(refund.id);
  }

  async syncRefund(refundId: string): Promise<void> {
    const refund = await this.prisma.refund.findUnique({
      where: { id: refundId },
    });
    if (!refund || refund.status !== 'PENDING') return;
    await this.applyTransferStatus(refund, 'refunds');
  }

  async refunds(take = 100): Promise<RefundView[]> {
    const rows = await this.prisma.refund.findMany({
      orderBy: { createdAt: 'desc' },
      take,
      select: { id: true },
    });
    return Promise.all(rows.map((r) => this.refundView(r.id)));
  }

  // ─── Payouts ─────────────────────────────────────────────────────────────

  /** "Pay out": MoMo transfers go out now; bank payouts wait for finance to confirm. */
  async createPayout(
    actorId: string,
    input: { workerId: string; amountRwf?: number; method: 'MOMO' | 'BANK' },
  ): Promise<PayoutView> {
    const payout = await this.prisma.$transaction(async (tx) => {
      // Serialise payouts per worker so the balance check holds
      await tx.$executeRaw`select 1 from app.workers where id = ${input.workerId}::uuid for update`;
      const worker = await tx.worker.findUnique({
        where: { id: input.workerId },
      });
      if (!worker)
        throw new NotFoundError('worker_not_found', 'Worker not found');
      const balanceRwf = await ledgerBalance(tx, {
        account: 'WORKER',
        workerId: worker.id,
      });
      const amountRwf = input.amountRwf ?? balanceRwf;
      assertPayoutAmount(amountRwf, balanceRwf);

      let destination: string;
      if (input.method === 'MOMO') {
        if (!worker.payoutMsisdn)
          throw new InvalidInputError(
            'no_momo_number',
            'Add the worker’s Mobile Money number first',
          );
        destination = `MoMo · ${maskMsisdn(toMsisdn(worker.payoutMsisdn))}`;
      } else {
        if (!worker.payoutBankName || !worker.payoutBankAccount) {
          throw new InvalidInputError(
            'no_bank_account',
            'Add the worker’s bank details first',
          );
        }
        destination = `${worker.payoutBankName} · •••• ${worker.payoutBankAccount.slice(-4)}`;
      }

      const created = await tx.payout.create({
        data: {
          workerId: worker.id,
          amountRwf,
          method: input.method,
          destination,
          initiatedById: actorId,
          providerReference: input.method === 'MOMO' ? randomUUID() : null,
        },
      });
      await postLedger(tx, [
        {
          account: 'WORKER',
          kind: 'PAYOUT',
          amountRwf: -amountRwf,
          workerId: worker.id,
          payoutId: created.id,
        },
      ]);
      await this.audit.record(
        {
          actorId,
          action: 'payout.created',
          entityType: 'payout',
          entityId: created.id,
          data: { workerId: worker.id, amountRwf, method: input.method },
        },
        tx,
      );
      return {
        ...created,
        msisdn: worker.payoutMsisdn ? toMsisdn(worker.payoutMsisdn) : null,
      };
    });

    if (payout.method === 'MOMO') {
      await this.sendTransfer(
        { ...payout, msisdn: payout.msisdn! },
        'payouts',
        'TrustedHands payout',
      );
    }
    return this.payoutView(payout.id);
  }

  /** Bank payouts: finance confirms the transfer went out. */
  async markPayoutPaid(
    actorId: string,
    payoutId: string,
    reference: string,
  ): Promise<PayoutView> {
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.payout.updateMany({
        where: { id: payoutId, method: 'BANK', status: 'PENDING' },
        data: {
          status: 'SUCCESSFUL',
          manualReference: reference.trim(),
          completedAt: new Date(),
        },
      });
      if (!count)
        throw new ConflictError(
          'not_pending_bank_payout',
          'Only pending bank payouts can be marked as paid',
        );
      await this.audit.record(
        {
          actorId,
          action: 'payout.marked_paid',
          entityType: 'payout',
          entityId: payoutId,
          data: { reference },
        },
        tx,
      );
    });
    return this.payoutView(payoutId);
  }

  /** Bank payouts: the transfer didn't happen; the money goes back to the wallet. */
  async failBankPayout(
    actorId: string,
    payoutId: string,
    reason: string,
  ): Promise<PayoutView> {
    const payout = await this.prisma.payout.findUnique({
      where: { id: payoutId },
    });
    if (!payout || payout.method !== 'BANK' || payout.status !== 'PENDING') {
      throw new ConflictError(
        'not_pending_bank_payout',
        'Only pending bank payouts can be marked as failed',
      );
    }
    await this.settleTransfer(
      'payouts',
      payout,
      { status: 'FAILED', reason: reason.trim() },
      actorId,
    );
    return this.payoutView(payoutId);
  }

  async syncPayout(payoutId: string): Promise<void> {
    const payout = await this.prisma.payout.findUnique({
      where: { id: payoutId },
    });
    if (!payout || payout.status !== 'PENDING' || payout.method !== 'MOMO')
      return;
    await this.applyTransferStatus(payout, 'payouts');
  }

  async payouts(): Promise<PayoutsView> {
    const [balances, rows] = await Promise.all([
      this.prisma.ledgerEntry.groupBy({
        by: ['workerId'],
        where: { account: 'WORKER' },
        _sum: { amountRwf: true },
        having: { amountRwf: { _sum: { gt: 0 } } },
      }),
      this.prisma.payout.findMany({
        orderBy: { createdAt: 'desc' },
        take: 100,
        select: { id: true },
      }),
    ]);
    const workers = await this.prisma.worker.findMany({
      where: { id: { in: balances.map((b) => b.workerId!) } },
      select: {
        id: true,
        fullName: true,
        payoutMsisdn: true,
        payoutBankName: true,
        payoutBankAccount: true,
      },
    });
    const toPay: WorkerBalanceView[] = workers
      .map((w) => ({
        workerId: w.id,
        fullName: w.fullName,
        balanceRwf:
          balances.find((b) => b.workerId === w.id)!._sum.amountRwf ?? 0,
        payoutMethod: w.payoutMsisdn
          ? ('MOMO' as const)
          : w.payoutBankAccount
            ? ('BANK' as const)
            : null,
        destination: w.payoutMsisdn
          ? `MoMo · ${maskMsisdn(toMsisdn(w.payoutMsisdn))}`
          : w.payoutBankName && w.payoutBankAccount
            ? `${w.payoutBankName} · •••• ${w.payoutBankAccount.slice(-4)}`
            : null,
      }))
      .sort((a, b) => b.balanceRwf - a.balanceRwf);
    return {
      toPay,
      payouts: await Promise.all(rows.map((r) => this.payoutView(r.id))),
    };
  }

  async workerWallet(workerId: string): Promise<WorkerWalletView> {
    const [balanceRwf, entries] = await Promise.all([
      ledgerBalance(this.prisma, { account: 'WORKER', workerId }),
      this.prisma.ledgerEntry.findMany({
        where: { account: 'WORKER', workerId },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
    ]);
    const requests = await this.prisma.serviceRequest.findMany({
      where: {
        id: {
          in: entries.flatMap((e) =>
            e.serviceRequestId ? [e.serviceRequestId] : [],
          ),
        },
      },
      select: { id: true, number: true },
    });
    const refs = new Map(
      requests.map((r) => [r.id, formatRequestRef(r.number)]),
    );
    return {
      balanceRwf,
      entries: entries.map((e) => ({
        id: e.id,
        kind: e.kind,
        amountRwf: e.amountRwf,
        serviceRequestReference: e.serviceRequestId
          ? (refs.get(e.serviceRequestId) ?? null)
          : null,
        at: e.createdAt,
      })),
    };
  }

  // ─── Reporting ───────────────────────────────────────────────────────────

  async overview(now = new Date()): Promise<FinanceOverviewView> {
    const monthStart = kigaliMonthStart(now);
    const [
      platform,
      fees,
      escrow,
      workers,
      workerCount,
      payoutsPending,
      refundsPending,
    ] = await Promise.all([
      ledgerBalance(this.prisma, { account: 'PLATFORM' }),
      ledgerBalance(this.prisma, {
        account: 'PLATFORM',
        kind: 'RELEASED_TO_PLATFORM',
        createdAt: { gte: monthStart },
      }),
      ledgerBalance(this.prisma, { account: 'ESCROW' }),
      ledgerBalance(this.prisma, { account: 'WORKER' }),
      this.prisma.ledgerEntry
        .groupBy({
          by: ['workerId'],
          where: { account: 'WORKER' },
          _sum: { amountRwf: true },
          having: { amountRwf: { _sum: { gt: 0 } } },
        })
        .then((g) => g.length),
      this.prisma.payout.aggregate({
        where: { status: 'PENDING' },
        _sum: { amountRwf: true },
      }),
      this.prisma.refund.aggregate({
        where: { status: 'PENDING' },
        _sum: { amountRwf: true },
      }),
    ]);
    return {
      platformBalanceRwf: platform,
      feesThisMonthRwf: fees,
      escrowRwf: escrow,
      workerWalletsRwf: workers,
      workersWithBalance: workerCount,
      payoutsPendingRwf: payoutsPending._sum.amountRwf ?? 0,
      refundsPendingRwf: refundsPending._sum.amountRwf ?? 0,
    };
  }

  async transactions(filter: {
    skip: number;
    take: number;
  }): Promise<TransactionPageView> {
    const where: Prisma.PaymentWhereInput = { status: 'SUCCESSFUL' };
    const [rows, total] = await Promise.all([
      this.prisma.payment.findMany({
        where,
        orderBy: { completedAt: 'desc' },
        skip: filter.skip,
        take: filter.take,
        include: {
          client: { select: { fullName: true } },
          serviceRequest: {
            select: {
              id: true,
              number: true,
              workerFeeRwf: true,
              assignedWorkerId: true,
              releasedAt: true,
              serviceType: { select: { label: true } },
            },
          },
          refunds: {
            where: { status: OPEN_REFUND },
            select: { amountRwf: true, chargedTo: true },
          },
        },
      }),
      this.prisma.payment.count({ where }),
    ]);
    const released = await this.prisma.ledgerEntry.groupBy({
      by: ['serviceRequestId', 'kind'],
      where: {
        account: { in: ['WORKER', 'PLATFORM'] },
        kind: { in: ['RELEASED_TO_WORKER', 'RELEASED_TO_PLATFORM'] },
        serviceRequestId: { in: rows.map((r) => r.serviceRequestId) },
      },
      _sum: { amountRwf: true },
    });
    const releasedOf = (
      requestId: string,
      kind: 'RELEASED_TO_WORKER' | 'RELEASED_TO_PLATFORM',
    ) =>
      released.find((r) => r.serviceRequestId === requestId && r.kind === kind)
        ?._sum.amountRwf ?? 0;

    const items: TransactionRowView[] = rows.map((p) => {
      const refundedRwf = p.refunds.reduce((sum, r) => sum + r.amountRwf, 0);
      const sr = p.serviceRequest;
      const settled = sr.releasedAt !== null;
      // Before release, show what the split will be
      const planned = splitEscrow({
        escrowRwf:
          p.amountRwf -
          p.refunds
            .filter((r) => r.chargedTo === 'ESCROW')
            .reduce((s, r) => s + r.amountRwf, 0),
        workerFeeRwf: sr.assignedWorkerId ? (sr.workerFeeRwf ?? 0) : 0,
        refundedRwf: p.refunds
          .filter((r) => r.chargedTo === 'ESCROW')
          .reduce((s, r) => s + r.amountRwf, 0),
      });
      return {
        paymentId: p.id,
        receiptReference: formatReceiptRef(p.receiptNumber),
        paidAt: p.completedAt ?? p.createdAt,
        clientName: p.client.fullName,
        serviceLabel: sr.serviceType.label,
        serviceRequestId: sr.id,
        serviceRequestReference: formatRequestRef(sr.number),
        amountRwf: p.amountRwf,
        workerShareRwf: settled
          ? releasedOf(sr.id, 'RELEASED_TO_WORKER')
          : planned.workerRwf,
        feeRwf: settled
          ? releasedOf(sr.id, 'RELEASED_TO_PLATFORM')
          : planned.platformRwf,
        refundedRwf,
        status: settled ? 'SETTLED' : 'IN_ESCROW',
      };
    });
    return { items, total };
  }

  /** "Export CSV": all successful payments. */
  async transactionsCsv(): Promise<string> {
    const { items } = await this.transactions({ skip: 0, take: 10_000 });
    const header = [
      'Receipt',
      'Paid at',
      'Client',
      'Service',
      'Request',
      'Paid (RWF)',
      'Worker (RWF)',
      'Fee (RWF)',
      'Refunded (RWF)',
      'Status',
    ];
    const lines = items.map((r) =>
      [
        r.receiptReference,
        r.paidAt.toISOString(),
        r.clientName,
        r.serviceLabel,
        r.serviceRequestReference,
        r.amountRwf,
        r.workerShareRwf,
        r.feeRwf,
        r.refundedRwf,
        r.status === 'SETTLED' ? 'Settled' : 'In escrow',
      ]
        .map(csvCell)
        .join(','),
    );
    return [header.join(','), ...lines].join('\r\n') + '\r\n';
  }

  // ─── Transfers (shared by refunds and payouts) ──────────────────────────

  private async sendTransfer(
    row: {
      id: string;
      amountRwf: number;
      msisdn: string;
      providerReference: string | null;
    },
    kind: 'refunds' | 'payouts',
    message: string,
  ): Promise<void> {
    try {
      await this.transfers.transfer({
        referenceId: row.providerReference!,
        amount: row.amountRwf,
        msisdn: toMsisdn(row.msisdn),
        externalId: row.id,
        message,
        callbackPath: `${kind}/${row.id}`,
      });
    } catch (error) {
      if (
        error instanceof PaymentRejectedError ||
        (error as { code?: string }).code === 'momo_not_configured'
      ) {
        const current = await this.load(kind, row.id);
        await this.settleTransfer(
          kind,
          current,
          { status: 'FAILED', reason: (error as Error).message },
          null,
        );
        return;
      }
      // Ambiguous (timeout/5xx): MoMo may have accepted it; status checks will settle it
      this.logger.warn(
        `${kind} ${row.id}: transfer outcome unknown: ${String(error)}`,
      );
    }
  }

  private async applyTransferStatus(
    row: Refund | Payout,
    kind: 'refunds' | 'payouts',
  ): Promise<void> {
    let result;
    try {
      result = await this.transfers.getTransferStatus(row.providerReference!);
    } catch (error) {
      this.logger.warn(
        `${kind} ${row.id}: status check failed: ${String(error)}`,
      );
      return;
    }
    if (result.status === 'PENDING') return;
    if (result.status === 'NOT_FOUND') {
      if (Date.now() - row.createdAt.getTime() < NOT_FOUND_GRACE_MS) return;
      await this.settleTransfer(
        kind,
        row,
        { status: 'FAILED', reason: 'MoMo did not receive the transfer' },
        null,
      );
      return;
    }
    await this.settleTransfer(kind, row, result, null);
  }

  /** Conditional on still being PENDING, so callback and polling can't both apply it. */
  private async settleTransfer(
    kind: 'refunds' | 'payouts',
    row: Refund | Payout,
    outcome:
      | { status: 'SUCCESSFUL'; transactionId: string | null }
      | { status: 'FAILED'; reason: string },
    actorId: string | null,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const data =
        outcome.status === 'SUCCESSFUL'
          ? {
              status: 'SUCCESSFUL' as const,
              providerTransactionId: outcome.transactionId,
              completedAt: new Date(),
            }
          : {
              status: 'FAILED' as const,
              failureReason: outcome.reason,
              completedAt: new Date(),
            };
      const { count } =
        kind === 'refunds'
          ? await tx.refund.updateMany({
              where: { id: row.id, status: 'PENDING' },
              data,
            })
          : await tx.payout.updateMany({
              where: { id: row.id, status: 'PENDING' },
              data,
            });
      if (!count || outcome.status === 'SUCCESSFUL') return;

      // Failed: give back what was reserved
      let auditEntity: {
        entityType: 'service_request' | 'payout';
        entityId: string;
      } = { entityType: 'payout', entityId: row.id };
      if (kind === 'refunds') {
        const refund = row as Refund;
        const payment = await tx.payment.findUniqueOrThrow({
          where: { id: refund.paymentId },
        });
        await postLedger(tx, [
          {
            account: refund.chargedTo,
            kind: 'REFUND_REVERSED',
            amountRwf: refund.amountRwf,
            refundId: refund.id,
            paymentId: payment.id,
            serviceRequestId: payment.serviceRequestId,
          },
        ]);
        // Refunds are audited on their request, like refund_issued
        auditEntity = {
          entityType: 'service_request',
          entityId: payment.serviceRequestId,
        };
      } else {
        const payout = row as Payout;
        await postLedger(tx, [
          {
            account: 'WORKER',
            kind: 'PAYOUT_REVERSED',
            amountRwf: payout.amountRwf,
            workerId: payout.workerId,
            payoutId: payout.id,
          },
        ]);
      }
      this.logger.warn(`${kind} ${row.id} failed: ${outcome.reason}`);
      if (actorId) {
        await this.audit.record(
          {
            actorId,
            action: `${kind === 'refunds' ? 'refund' : 'payout'}.failed`,
            ...auditEntity,
            data: {
              reason: outcome.reason,
              [kind === 'refunds' ? 'refundId' : 'payoutId']: row.id,
            },
          },
          tx,
        );
      }
    });
  }

  private async load(
    kind: 'refunds' | 'payouts',
    id: string,
  ): Promise<Refund | Payout> {
    return kind === 'refunds'
      ? this.prisma.refund.findUniqueOrThrow({ where: { id } })
      : this.prisma.payout.findUniqueOrThrow({ where: { id } });
  }

  private async refundView(id: string): Promise<RefundView> {
    const r = await this.prisma.refund.findUniqueOrThrow({
      where: { id },
      include: {
        payment: {
          include: {
            client: { select: { fullName: true } },
            serviceRequest: { select: { id: true, number: true } },
          },
        },
      },
    });
    const issuer = await this.prisma.profile.findUnique({
      where: { id: r.issuedById },
      select: { fullName: true },
    });
    return {
      id: r.id,
      paymentId: r.paymentId,
      serviceRequestId: r.payment.serviceRequest.id,
      serviceRequestReference: formatRequestRef(
        r.payment.serviceRequest.number,
      ),
      clientName: r.payment.client.fullName,
      amountRwf: r.amountRwf,
      reason: r.reason,
      status: r.status,
      chargedTo: r.chargedTo as 'ESCROW' | 'PLATFORM',
      msisdnMasked: maskMsisdn(r.msisdn),
      failureReason: r.failureReason,
      ticketId: r.ticketId,
      issuedByName: issuer?.fullName ?? 'Former staff',
      createdAt: r.createdAt,
      completedAt: r.completedAt,
    };
  }

  private async payoutView(id: string): Promise<PayoutView> {
    const p = await this.prisma.payout.findUniqueOrThrow({
      where: { id },
      include: { worker: { select: { fullName: true } } },
    });
    const by = await this.prisma.profile.findUnique({
      where: { id: p.initiatedById },
      select: { fullName: true },
    });
    return {
      id: p.id,
      workerId: p.workerId,
      workerName: p.worker.fullName,
      amountRwf: p.amountRwf,
      method: p.method,
      destination: p.destination,
      status: p.status,
      initiatedByName: by?.fullName ?? 'Former staff',
      manualReference: p.manualReference,
      failureReason: p.failureReason,
      createdAt: p.createdAt,
      completedAt: p.completedAt,
    };
  }
}

async function lockRequest(tx: Db, id: string): Promise<void> {
  await tx.$executeRaw`select 1 from app.service_requests where id = ${id}::uuid for update`;
}

function kigaliMonthStart(now: Date): Date {
  const k = new Date(now.getTime() + KIGALI_OFFSET_MS);
  return new Date(
    Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), 1) - KIGALI_OFFSET_MS,
  );
}

/** Quotes a CSV cell; neutralises spreadsheet formulas. */
function csvCell(value: string | number): string {
  let s = String(value);
  if (/^[=+\-@\t\r]/.test(s) && typeof value === 'string') s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
