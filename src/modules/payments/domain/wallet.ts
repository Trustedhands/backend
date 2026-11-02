import { InvalidInputError } from '../../../shared/domain/domain-error.js';

/** Per top-up or ops credit, in RWF */
export const MIN_WALLET_AMOUNT_RWF = 500;
export const MAX_WALLET_AMOUNT_RWF = 1_000_000;

export type WalletEntryType =
  'TOP_UP' | 'ADJUSTMENT' | 'PAYMENT_DEBIT' | 'REFUND_CREDIT';

/** Top-ups and ops credits: whole RWF within the limits. */
export function assertWalletAmount(amountRwf: number): void {
  if (
    !Number.isInteger(amountRwf) ||
    amountRwf < MIN_WALLET_AMOUNT_RWF ||
    amountRwf > MAX_WALLET_AMOUNT_RWF
  ) {
    throw new InvalidInputError(
      'invalid_amount',
      `Enter an amount between ${MIN_WALLET_AMOUNT_RWF.toLocaleString('en-US')} and ${MAX_WALLET_AMOUNT_RWF.toLocaleString('en-US')} RWF`,
    );
  }
}

/** How a wallet line reads to the client and to ops. */
export function walletEntryLabel(
  type: WalletEntryType,
  serviceRequestReference: string | null,
): string {
  switch (type) {
    case 'TOP_UP':
      return 'Top-up from Mobile Money';
    case 'ADJUSTMENT':
      return 'Credit from TrustedHands';
    case 'PAYMENT_DEBIT':
      return serviceRequestReference
        ? `Payment for ${serviceRequestReference}`
        : 'Payment';
    case 'REFUND_CREDIT':
      return serviceRequestReference
        ? `Refund for ${serviceRequestReference}`
        : 'Refund';
  }
}
