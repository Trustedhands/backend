import type { ProviderPaymentStatus } from './mobile-money.gateway.js';

/** Port for sending money out (MTN MoMo Disbursement): refunds and worker payouts. */
export abstract class MoneyTransferGateway {
  /**
   * Starts a transfer. Throws PaymentRejectedError when MoMo definitively
   * refuses it; any other error means the outcome is unknown.
   */
  abstract transfer(input: {
    referenceId: string;
    amount: number;
    msisdn: string;
    /** Our id, echoed back by MoMo */
    externalId: string;
    message: string;
    /** e.g. "refunds/<id>" or "payouts/<id>" under the disbursement callback base */
    callbackPath: string;
  }): Promise<void>;

  abstract getTransferStatus(
    referenceId: string,
  ): Promise<ProviderPaymentStatus>;
}
