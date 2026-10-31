import { maskMsisdn, normalizeMsisdn } from './msisdn.js';

describe('normalizeMsisdn', () => {
  it.each([
    '078 123 4567',
    '0781234567',
    '+250781234567',
    '250781234567',
    '+250 (78) 123-4567',
  ])('normalises %s', (input) =>
    expect(normalizeMsisdn(input, true)).toBe('250781234567'),
  );

  it('accepts MTN 079 numbers', () =>
    expect(normalizeMsisdn('0791234567', true)).toBe('250791234567'));

  it.each(['0721234567', '078123456', '1234'])(
    'rejects %s in strict mode',
    (input) =>
      expect(() => normalizeMsisdn(input, true)).toThrow(
        expect.objectContaining({ code: 'invalid_msisdn' }),
      ),
  );

  it('allows sandbox test numbers when not strict', () =>
    expect(normalizeMsisdn('46733123450', false)).toBe('46733123450'));
});

describe('maskMsisdn', () => {
  it('masks like the design', () =>
    expect(maskMsisdn('250781234567')).toBe('078 *** 4567'));
});
