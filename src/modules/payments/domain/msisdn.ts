import { InvalidInputError } from '../../../shared/domain/domain-error.js';

/**
 * Normalises a Rwandan mobile number to MSISDN form (2507XXXXXXXX).
 * Accepts "078 123 4567", "0781234567", "+250781234567" or "250781234567".
 * `strict` limits it to MTN Rwanda prefixes (078/079); the MoMo sandbox uses
 * its own test numbers, so non-production callers pass false.
 */
export function normalizeMsisdn(input: string, strict: boolean): string {
  let digits = input.replace(/[\s\-()]/g, '').replace(/^\+/, '');
  if (/^0\d{9}$/.test(digits)) digits = `250${digits.slice(1)}`;

  const valid = strict
    ? /^2507[89]\d{7}$/.test(digits)
    : /^\d{9,15}$/.test(digits);
  if (!valid) {
    throw new InvalidInputError(
      'invalid_msisdn',
      'Enter a valid MTN Mobile Money number, e.g. 078 123 4567',
    );
  }
  return digits;
}

/** "250781234567" → "078 *** 4567", as shown in the design. */
export function maskMsisdn(msisdn: string): string {
  const local = msisdn.startsWith('250') ? `0${msisdn.slice(3)}` : msisdn;
  return `${local.slice(0, 3)} *** ${local.slice(-4)}`;
}
