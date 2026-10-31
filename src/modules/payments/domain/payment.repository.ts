import type { Db } from '../../../shared/database/prisma.service.js';
import type { Payment } from './payment.js';

export abstract class PaymentRepository {
  abstract findById(id: string, db?: Db): Promise<Payment | null>;
  abstract findPendingForRequest(
    serviceRequestId: string,
    db?: Db,
  ): Promise<Payment | null>;
  abstract create(payment: Payment, db?: Db): Promise<Payment>;
  /**
   * Persists a settled payment only if it is still PENDING in the database.
   * Returns false if another process (callback vs. poll) settled it first.
   */
  abstract settle(payment: Payment, db?: Db): Promise<boolean>;
}
