import { Injectable } from '@nestjs/common';
import type { Payment as PaymentRow } from '../../../generated/prisma/client.js';
import {
  type Db,
  PrismaService,
} from '../../../shared/database/prisma.service.js';
import { Payment } from '../domain/payment.js';
import { PaymentRepository } from '../domain/payment.repository.js';

@Injectable()
export class PrismaPaymentRepository extends PaymentRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async findById(id: string, db: Db = this.prisma): Promise<Payment | null> {
    const row = await db.payment.findUnique({ where: { id } });
    return row ? toDomain(row) : null;
  }

  async findPendingForRequest(
    serviceRequestId: string,
    db: Db = this.prisma,
  ): Promise<Payment | null> {
    const row = await db.payment.findFirst({
      where: { serviceRequestId, status: 'PENDING' },
      orderBy: { createdAt: 'desc' },
    });
    return row ? toDomain(row) : null;
  }

  async create(payment: Payment, db: Db = this.prisma): Promise<Payment> {
    const s = payment.toSnapshot();
    const row = await db.payment.create({
      data: {
        id: s.id,
        serviceRequestId: s.serviceRequestId,
        clientId: s.clientId,
        provider: 'MTN_MOMO',
        amountRwf: s.amountRwf,
        status: s.status,
        msisdn: s.msisdn,
        providerReference: s.providerReference,
        createdAt: s.createdAt,
      },
    });
    return toDomain(row);
  }

  async settle(payment: Payment, db: Db = this.prisma): Promise<boolean> {
    const s = payment.toSnapshot();
    const { count } = await db.payment.updateMany({
      where: { id: s.id, status: 'PENDING' },
      data: {
        status: s.status,
        providerTransactionId: s.providerTransactionId,
        failureReason: s.failureReason,
        completedAt: s.completedAt,
      },
    });
    return count === 1;
  }
}

function toDomain(row: PaymentRow): Payment {
  return Payment.rehydrate({
    id: row.id,
    receiptNumber: row.receiptNumber,
    serviceRequestId: row.serviceRequestId,
    clientId: row.clientId,
    amountRwf: row.amountRwf,
    status: row.status,
    msisdn: row.msisdn ?? '',
    providerReference: row.providerReference ?? '',
    providerTransactionId: row.providerTransactionId,
    failureReason: row.failureReason,
    completedAt: row.completedAt,
    createdAt: row.createdAt,
  });
}
