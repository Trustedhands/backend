import { randomUUID } from 'node:crypto';
import { ConflictError } from '../../../shared/domain/domain-error.js';

export type PaymentStatus = 'PENDING' | 'SUCCESSFUL' | 'FAILED';

export interface PaymentProps {
  id: string;
  receiptNumber: number | null;
  serviceRequestId: string;
  clientId: string;
  amountRwf: number;
  status: PaymentStatus;
  msisdn: string;
  /** X-Reference-Id used with MoMo requesttopay */
  providerReference: string;
  providerTransactionId: string | null;
  failureReason: string | null;
  completedAt: Date | null;
  createdAt: Date;
}

/** A single MoMo charge for a priced service request. */
export class Payment {
  private constructor(private props: PaymentProps) {}

  static initiate(
    input: {
      serviceRequestId: string;
      clientId: string;
      amountRwf: number;
      msisdn: string;
    },
    now = new Date(),
  ): Payment {
    return new Payment({
      id: randomUUID(),
      receiptNumber: null,
      ...input,
      status: 'PENDING',
      providerReference: randomUUID(),
      providerTransactionId: null,
      failureReason: null,
      completedAt: null,
      createdAt: now,
    });
  }

  static rehydrate(props: PaymentProps): Payment {
    return new Payment({ ...props });
  }

  get id() {
    return this.props.id;
  }
  get status() {
    return this.props.status;
  }
  get serviceRequestId() {
    return this.props.serviceRequestId;
  }
  get clientId() {
    return this.props.clientId;
  }
  get amountRwf() {
    return this.props.amountRwf;
  }
  get msisdn() {
    return this.props.msisdn;
  }
  get providerReference() {
    return this.props.providerReference;
  }
  get createdAt() {
    return this.props.createdAt;
  }

  succeed(providerTransactionId: string | null, now = new Date()): void {
    this.assertPending();
    this.props.status = 'SUCCESSFUL';
    this.props.providerTransactionId = providerTransactionId;
    this.props.completedAt = now;
  }

  fail(reason: string, now = new Date()): void {
    this.assertPending();
    this.props.status = 'FAILED';
    this.props.failureReason = reason;
    this.props.completedAt = now;
  }

  toSnapshot(): Readonly<PaymentProps> {
    return { ...this.props };
  }

  private assertPending() {
    if (this.props.status !== 'PENDING') {
      throw new ConflictError(
        'payment_not_pending',
        `Payment is already ${this.props.status.toLowerCase()}`,
      );
    }
  }
}
