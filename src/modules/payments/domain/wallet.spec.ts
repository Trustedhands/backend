import { assertWalletAmount, walletEntryLabel } from './wallet.js';

describe('wallet', () => {
  it.each([500, 25_000, 1_000_000])('accepts %i RWF', (amount) => {
    expect(() => assertWalletAmount(amount)).not.toThrow();
  });

  it.each([0, 499, 1_000_001, 1500.5, -500])('rejects %d RWF', (amount) => {
    expect(() => assertWalletAmount(amount)).toThrow(
      expect.objectContaining({ code: 'invalid_amount' }),
    );
  });

  it('labels entries for clients and ops', () => {
    expect(walletEntryLabel('PAYMENT_DEBIT', 'SR-1042')).toBe(
      'Payment for SR-1042',
    );
    expect(walletEntryLabel('REFUND_CREDIT', 'SR-1042')).toBe(
      'Refund for SR-1042',
    );
    expect(walletEntryLabel('ADJUSTMENT', null)).toBe(
      'Credit from TrustedHands',
    );
  });
});
