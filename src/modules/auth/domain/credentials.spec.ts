import {
  assertPasswordPolicy,
  normalizeEmail,
  normalizeRwandaPhone,
} from './credentials.js';

describe('credentials', () => {
  it('normalises email', () =>
    expect(normalizeEmail('  Claire@Example.COM ')).toBe('claire@example.com'));

  it.each([
    '078 123 4567',
    '0781234567',
    '781234567',
    '+250781234567',
    '250 78 123 4567',
  ])('normalises phone %s', (input) =>
    expect(normalizeRwandaPhone(input)).toBe('+250781234567'),
  );

  it.each(['0712345678', '07812345', '+254712345678'])(
    'rejects phone %s',
    (input) =>
      expect(() => normalizeRwandaPhone(input)).toThrow(
        expect.objectContaining({ code: 'invalid_phone' }),
      ),
  );

  it.each(['short1', 'longenoughbutnodigits', 'x'.repeat(128) + '1'])(
    'rejects password %s',
    (pw) =>
      expect(() => assertPasswordPolicy(pw)).toThrow(
        expect.objectContaining({ code: 'weak_password' }),
      ),
  );

  it('accepts a password with a number', () =>
    expect(() => assertPasswordPolicy('kigali2026')).not.toThrow());
});
