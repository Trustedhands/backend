import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma/client.js';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../../config/env.js';
import {
  ConflictError,
  NotFoundError,
  UnavailableError,
} from '../../../shared/domain/domain-error.js';
import { PrismaService } from '../../../shared/database/prisma.service.js';
import { postLedger } from '../../../shared/ledger/ledger.js';
import { formatRequestRef } from '../../../shared/http/references.js';
import { ConfigurationService } from '../../configuration/application/configuration.service.js';
import { ServiceRequestRepository } from '../../service-requests/domain/service-request.repository.js';
import { normalizeMsisdn } from '../domain/msisdn.js';
import { Payment } from '../domain/payment.js';
import { PaymentRepository } from '../domain/payment.repository.js';
import {
  MobileMoneyGateway,
  PaymentRejectedError,
} from './mobile-money.gateway.js';
import { lockWallet, walletBalance } from './wallet.service.js';

/** How long MoMo may report "no such request" before we treat the payment as failed. */
const NOT_FOUND_GRACE_MS = 5 * 60_000;

/** Request-domain errors that mean "this payment can't be applied", not "retry". */
const UNAPPLIABLE_CODES = new Set([
  'invalid_status_transition',
  'payment_amount_mismatch',
]);

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly payments: PaymentRepository,
    private readonly requests: ServiceRequestRepository,
    private readonly gateway: MobileMoneyGateway,
    private readonly config: ConfigService<Env, true>,
    private readonly settings: ConfigurationService,
  ) {}

  /** "Accept & pay" from the client's wallet: settles at once, no MoMo prompt. */
  async payFromWallet(
    clientId: string,
    serviceRequestId: string,
  ): Promise<Payment> {
    if (!(await this.settings.settings()).clientWalletEnabled) {
      throw new UnavailableError(
        'wallet_disabled',
        "Paying from your wallet isn't available right now",
      );
    }
    const id = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`select 1 from app.service_requests where id = ${serviceRequestId}::uuid for update`;
      const request = await this.requests.findById(serviceRequestId, tx);
      if (!request || !request.isOwnedBy(clientId)) {
        throw new NotFoundError(
          'service_request_not_found',
          'Request not found',
        );
      }
      if (await this.payments.findPendingForRequest(serviceRequestId, tx)) {
        throw new ConflictError(
          'payment_in_progress',
          'A Mobile Money payment for this request is waiting on your phone',
        );
      }
      if (request.status !== 'PRICED' || request.totalRwf === null) {
        throw new ConflictError(
          'not_payable',
          'This request has no price to pay yet',
        );
      }
      await lockWallet(tx, clientId);
      if ((await walletBalance(tx, clientId)) < request.totalRwf) {
        throw new ConflictError(
          'insufficient_wallet',
          'Your wallet balance is too low. Top up or pay with Mobile Money.',
        );
      }
      const payment = await this.payments.create(
        Payment.initiate({
          serviceRequestId,
          clientId,
          amountRwf: request.totalRwf,
        }),
        tx,
      );
      await tx.walletEntry.create({
        data: {
          profileId: clientId,
          type: 'PAYMENT_DEBIT',
          amountRwf: -payment.amountRwf,
          paymentId: payment.id,
        },
      });
      await this.recordSuccess(tx, payment, null);
      return payment.id;
    });
    return (await this.payments.findById(id))!;
  }

  /** "Accept & pay": charges the request's current price via MoMo. */
  async initiate(
    clientId: string,
    serviceRequestId: string,
    rawMsisdn: string,
  ): Promise<Payment> {
    const strict =
      this.config.get('MOMO_TARGET_ENVIRONMENT', { infer: true }) !== 'sandbox';
    const msisdn = normalizeMsisdn(rawMsisdn, strict);
    // Ops can pause payments from Settings (e.g. during a MoMo outage)
    if (!(await this.settings.settings()).momoEnabled) {
      throw new UnavailableError(
        'payments_paused',
        'Mobile Money payments are paused right now. Please try again later.',
      );
    }

    const outcome = await this.prisma.$transaction(async (tx) => {
      // Serialise payment attempts (and price changes) for this request
      await tx.$executeRaw`select 1 from app.service_requests where id = ${serviceRequestId}::uuid for update`;

      const request = await this.requests.findById(serviceRequestId, tx);
      if (!request || !request.isOwnedBy(clientId)) {
        throw new NotFoundError(
          'service_request_not_found',
          'Request not found',
        );
      }
      const pending = await this.payments.findPendingForRequest(
        serviceRequestId,
        tx,
      );
      if (pending) return { payment: pending, created: false as const };

      if (request.status !== 'PRICED' || request.totalRwf === null) {
        throw new ConflictError(
          'not_payable',
          'This request has no price to pay yet',
        );
      }
      // A price change or cancellation loaded before this point must now fail
      // its version check instead of slipping in behind the charge
      await tx.serviceRequest.update({
        where: { id: serviceRequestId },
        data: { version: { increment: 1 } },
      });
      const payment = await this.payments.create(
        Payment.initiate({
          serviceRequestId,
          clientId,
          amountRwf: request.totalRwf,
          msisdn,
        }),
        tx,
      );
      return {
        payment,
        created: true as const,
        reference: formatRequestRef(request.number!),
      };
    });

    // A double tap while a charge is already on the payer's phone: report on that one
    if (!outcome.created) return this.sync(outcome.payment);

    const { payment, reference } = outcome;
    try {
      await this.gateway.requestToPay({
        referenceId: payment.providerReference,
        amount: payment.amountRwf,
        msisdn,
        externalId: payment.id,
        message: `TrustedHands ${reference}`,
      });
    } catch (error) {
      if (error instanceof PaymentRejectedError || isNotConfigured(error)) {
        payment.fail(
          error instanceof Error ? error.message : 'Payment request rejected',
        );
        await this.payments.settle(payment);
        if (isNotConfigured(error)) throw error;
        return payment;
      }
      // Timeouts and 5xx are ambiguous: MoMo may have accepted the request.
      // Leave it PENDING; status checks will settle it either way.
      this.logger.warn(
        `requesttopay outcome unknown for payment ${payment.id}: ${String(error)}`,
      );
    }
    return payment;
  }

  async getForClient(clientId: string, paymentId: string): Promise<Payment> {
    const payment = await this.payments.findById(paymentId);
    if (!payment || payment.clientId !== clientId) {
      throw new NotFoundError('payment_not_found', 'Payment not found');
    }
    return this.sync(payment);
  }

  /**
   * MoMo callback. Its body is not authenticated, so it is only used as a
   * prompt to ask MoMo for the authoritative status.
   */
  async handleProviderCallback(paymentId: string): Promise<void> {
    const payment = await this.payments.findById(paymentId);
    if (payment) await this.sync(payment);
  }

  /** Used by the settlement job for payments nobody is polling. */
  async syncById(paymentId: string): Promise<void> {
    const payment = await this.payments.findById(paymentId);
    if (payment) await this.sync(payment);
  }

  /** Brings a PENDING payment up to date with MoMo. */
  async sync(payment: Payment): Promise<Payment> {
    if (payment.status !== 'PENDING') return payment;

    let result;
    try {
      result = await this.gateway.getStatus(payment.providerReference);
    } catch (error) {
      this.logger.warn(
        `Status check failed for payment ${payment.id}: ${String(error)}`,
      );
      return payment;
    }

    switch (result.status) {
      case 'PENDING':
        return payment;
      case 'NOT_FOUND':
        if (Date.now() - payment.createdAt.getTime() < NOT_FOUND_GRACE_MS)
          return payment;
        payment.fail('MoMo did not receive the payment request');
        await this.payments.settle(payment);
        break;
      case 'FAILED':
        payment.fail(result.reason);
        await this.payments.settle(payment);
        break;
      case 'SUCCESSFUL':
        await this.applySuccess(payment, result.transactionId);
        break;
    }
    return (await this.payments.findById(payment.id))!;
  }

  private async applySuccess(
    payment: Payment,
    transactionId: string | null,
  ): Promise<void> {
    await this.prisma.$transaction((tx) =>
      this.recordSuccess(tx, payment, transactionId),
    );
  }

  /** Marks the payment successful, moves the money into escrow and the request to PAID. */
  private async recordSuccess(
    tx: Prisma.TransactionClient,
    payment: Payment,
    transactionId: string | null,
  ): Promise<void> {
    payment.succeed(transactionId);
    // Someone else (callback vs. poll) already settled it
    if (!(await this.payments.settle(payment, tx))) return;
    // The money now sits in escrow until the job is released
    await postLedger(tx, [
      {
        account: 'ESCROW',
        kind: 'PAYMENT_RECEIVED',
        amountRwf: payment.amountRwf,
        paymentId: payment.id,
        serviceRequestId: payment.serviceRequestId,
      },
    ]);

    const request = await this.requests.findById(payment.serviceRequestId, tx);
    try {
      request!.markPaid(payment.amountRwf);
      await this.requests.save(request!, tx);
    } catch (error) {
      const code = (error as { code?: string }).code;
      // A wallet payment can still be rolled back, so undo the debit instead
      if (!code || !UNAPPLIABLE_CODES.has(code) || payment.method === 'WALLET')
        throw error;
      // Money has moved, so keep the payment; ops must refund or fix the request
      this.logger.error(
        `Payment ${payment.id} succeeded but request ${payment.serviceRequestId} could not be marked paid ` +
          `(${code}). Needs manual review.`,
      );
    }

    if (payment.method !== 'MTN_MOMO') return;
    const hasDefault = await tx.savedPaymentMethod.count({
      where: { profileId: payment.clientId, isDefault: true },
    });
    await tx.savedPaymentMethod.upsert({
      where: {
        profileId_msisdn: {
          profileId: payment.clientId,
          msisdn: payment.msisdn,
        },
      },
      create: {
        profileId: payment.clientId,
        msisdn: payment.msisdn,
        isDefault: hasDefault === 0,
      },
      update: {},
    });
  }
}

function isNotConfigured(error: unknown): error is Error {
  return (error as { code?: string })?.code === 'momo_not_configured';
}
