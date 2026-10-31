import {
  assertPayoutAmount,
  assertRefundable,
  refundSource,
  releaseDueAt,
  splitEscrow,
} from './settlement.js';

describe('settlement rules', () => {
  it('splits escrow into worker fee and platform fee', () => {
    expect(
      splitEscrow({ escrowRwf: 21_000, workerFeeRwf: 20_000, refundedRwf: 0 }),
    ).toEqual({ workerRwf: 20_000, platformRwf: 1_000 });
  });

  it('takes pre-release refunds out of the worker share first', () => {
    expect(
      splitEscrow({
        escrowRwf: 19_000,
        workerFeeRwf: 20_000,
        refundedRwf: 2_000,
      }),
    ).toEqual({ workerRwf: 18_000, platformRwf: 1_000 });
    // Refund bigger than the worker fee eats into the platform fee
    expect(
      splitEscrow({
        escrowRwf: 500,
        workerFeeRwf: 20_000,
        refundedRwf: 20_500,
      }),
    ).toEqual({ workerRwf: 0, platformRwf: 500 });
  });

  it('gives placements (match fee only) entirely to the platform', () => {
    expect(
      splitEscrow({ escrowRwf: 5_000, workerFeeRwf: 0, refundedRwf: 0 }),
    ).toEqual({ workerRwf: 0, platformRwf: 5_000 });
  });

  it('charges refunds to escrow before release and to the platform after', () => {
    expect(refundSource(false)).toBe('ESCROW');
    expect(refundSource(true)).toBe('PLATFORM');
  });

  it('limits refunds to what was paid and what escrow still holds', () => {
    const base = {
      paidRwf: 21_000,
      alreadyRefundedRwf: 2_000,
      escrowRwf: 19_000,
    };
    expect(() =>
      assertRefundable({ ...base, amountRwf: 19_000 }),
    ).not.toThrow();
    expect(() => assertRefundable({ ...base, amountRwf: 19_001 })).toThrow(
      expect.objectContaining({ code: 'refund_exceeds_payment' }),
    );
    expect(() =>
      assertRefundable({ ...base, escrowRwf: 5_000, amountRwf: 6_000 }),
    ).toThrow(expect.objectContaining({ code: 'refund_exceeds_escrow' }));
    expect(() =>
      assertRefundable({ ...base, escrowRwf: null, amountRwf: 6_000 }),
    ).not.toThrow();
    expect(() => assertRefundable({ ...base, amountRwf: 0 })).toThrow(
      expect.objectContaining({ code: 'invalid_amount' }),
    );
  });

  it('releases a set time after the visit ends', () => {
    const at = releaseDueAt(new Date('2026-11-03T07:00:00Z'), 4, 24);
    expect(at.toISOString()).toBe('2026-11-04T11:00:00.000Z');
  });

  it('pays out only what the wallet holds', () => {
    expect(() => assertPayoutAmount(80_000, 80_000)).not.toThrow();
    expect(() => assertPayoutAmount(80_001, 80_000)).toThrow(
      expect.objectContaining({ code: 'insufficient_balance' }),
    );
  });
});
