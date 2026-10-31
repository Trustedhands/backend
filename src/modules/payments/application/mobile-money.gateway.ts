/** Port for the mobile-money provider (MTN MoMo Collections in production). */
export abstract class MobileMoneyGateway {
  /**
   * Asks the payer to approve a charge on their phone. Resolves once the
   * provider has accepted the request (not when the payer approves).
   * Throws PaymentRejectedError when the provider definitively refuses it;
   * any other error means the outcome is unknown.
   */
  abstract requestToPay(input: {
    referenceId: string;
    amount: number;
    msisdn: string;
    externalId: string;
    message: string;
  }): Promise<void>;

  abstract getStatus(referenceId: string): Promise<ProviderPaymentStatus>;
}

export type ProviderPaymentStatus =
  | { status: 'PENDING' }
  /** The provider has no record of this reference (yet). */
  | { status: 'NOT_FOUND' }
  | { status: 'SUCCESSFUL'; transactionId: string | null }
  | { status: 'FAILED'; reason: string };

export class PaymentRejectedError extends Error {}
