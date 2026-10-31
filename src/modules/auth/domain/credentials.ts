import { InvalidInputError } from '../../../shared/domain/domain-error.js';

export const normalizeEmail = (email: string) => email.trim().toLowerCase();

/** Same rule the app shows: at least 8 characters, with a number. */
export function assertPasswordPolicy(password: string): void {
  if (password.length < 8 || password.length > 128 || !/\d/.test(password)) {
    throw new InvalidInputError(
      'weak_password',
      'Use 8 to 128 characters, including at least one number',
    );
  }
}

/**
 * Rwandan mobile number → E.164 (+2507XXXXXXXX). Accepts "078 123 4567",
 * "0781234567", "+250781234567" or "250781234567".
 */
export function normalizeRwandaPhone(input: string): string {
  let digits = input.replace(/[\s\-()]/g, '').replace(/^\+/, '');
  if (/^0\d{9}$/.test(digits)) digits = `250${digits.slice(1)}`;
  if (/^7\d{8}$/.test(digits)) digits = `250${digits}`;
  if (!/^2507[2389]\d{7}$/.test(digits)) {
    throw new InvalidInputError(
      'invalid_phone',
      'Enter a Rwandan mobile number, e.g. 078 123 4567',
    );
  }
  return `+${digits}`;
}
