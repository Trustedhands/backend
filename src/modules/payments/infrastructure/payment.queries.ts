import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../shared/database/prisma.service.js';
import {
  formatReceiptRef,
  formatRequestRef,
} from '../../../shared/http/references.js';
import { maskMsisdn } from '../domain/msisdn.js';
import type { Payment } from '../domain/payment.js';
import type {
  PaymentHistoryView,
  PaymentView,
  TransactionView,
} from '../presentation/payment.views.js';

/** Kigali is UTC+2 all year (no DST). */
const KIGALI_OFFSET_MS = 2 * 60 * 60 * 1000;

@Injectable()
export class PaymentQueries {
  constructor(private readonly prisma: PrismaService) {}

  async view(payment: Payment): Promise<PaymentView> {
    const s = payment.toSnapshot();
    const receiptNumber =
      s.receiptNumber ??
      (
        await this.prisma.payment.findUniqueOrThrow({
          where: { id: s.id },
          select: { receiptNumber: true },
        })
      ).receiptNumber;
    return {
      id: s.id,
      receiptReference: formatReceiptRef(receiptNumber),
      serviceRequestId: s.serviceRequestId,
      amountRwf: s.amountRwf,
      status: s.status,
      msisdnMasked: maskMsisdn(s.msisdn),
      failureReason: s.failureReason,
      createdAt: s.createdAt,
      completedAt: s.completedAt,
    };
  }

  async history(
    clientId: string,
    now = new Date(),
  ): Promise<PaymentHistoryView> {
    const kigaliNow = new Date(now.getTime() + KIGALI_OFFSET_MS);
    const monthStart = new Date(
      Date.UTC(kigaliNow.getUTCFullYear(), kigaliNow.getUTCMonth(), 1) -
        KIGALI_OFFSET_MS,
    );

    const request = {
      select: {
        number: true,
        category: true,
        serviceType: { select: { label: true } },
      },
    } as const;
    const [payments, refunds, month, wallet] = await Promise.all([
      this.prisma.payment.findMany({
        where: { clientId },
        orderBy: { createdAt: 'desc' },
        take: 100,
        include: { serviceRequest: request },
      }),
      this.prisma.refund.findMany({
        where: { payment: { clientId } },
        orderBy: { createdAt: 'desc' },
        take: 100,
        include: { payment: { include: { serviceRequest: request } } },
      }),
      this.prisma.payment.aggregate({
        where: {
          clientId,
          status: 'SUCCESSFUL',
          completedAt: { gte: monthStart },
        },
        _sum: { amountRwf: true },
        _count: { _all: true },
      }),
      this.prisma.walletEntry.aggregate({
        where: { profileId: clientId },
        _sum: { amountRwf: true },
      }),
    ]);

    const transactions: TransactionView[] = [
      ...payments.map((p) => ({
        id: p.id,
        kind: 'PAYMENT' as const,
        category: p.serviceRequest.category,
        categoryLabel: p.serviceRequest.serviceType.label,
        serviceRequestReference: formatRequestRef(p.serviceRequest.number),
        receiptReference:
          p.status === 'SUCCESSFUL' ? formatReceiptRef(p.receiptNumber) : null,
        amountRwf: p.amountRwf,
        status: p.status,
        at: p.completedAt ?? p.createdAt,
      })),
      ...refunds.map((r) => ({
        id: r.id,
        kind: 'REFUND' as const,
        category: r.payment.serviceRequest.category,
        categoryLabel: r.payment.serviceRequest.serviceType.label,
        serviceRequestReference: formatRequestRef(
          r.payment.serviceRequest.number,
        ),
        receiptReference: formatReceiptRef(r.payment.receiptNumber),
        amountRwf: r.amountRwf,
        status: 'CREDITED' as const,
        at: r.createdAt,
      })),
    ].sort((a, b) => b.at.getTime() - a.at.getTime());

    return {
      monthSpentRwf: month._sum.amountRwf ?? 0,
      monthPaymentCount: month._count._all,
      walletBalanceRwf: wallet._sum.amountRwf ?? 0,
      transactions,
    };
  }
}
