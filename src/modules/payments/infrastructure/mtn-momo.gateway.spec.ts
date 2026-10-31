import { describeFailure } from './mtn-momo.gateway.js';

describe('describeFailure', () => {
  it('explains known MTN codes', () => {
    expect(describeFailure('NOT_ENOUGH_FUNDS')).toBe(
      'Your MoMo balance is too low for this payment.',
    );
    expect(describeFailure('APPROVAL_REJECTED')).toMatch(/declined/);
  });

  it('never shows raw unknown codes to payers', () => {
    expect(describeFailure('INTERNAL_PROCESSING_ERROR')).toBe(
      'MoMo could not complete the payment.',
    );
  });
});
