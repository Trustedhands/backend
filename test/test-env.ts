/**
 * Environment for the e2e tests. Set on every test worker (vitest `test.env`),
 * so nothing comes from .env: the database is the local Docker one, secrets are
 * dummies, and every external provider is faked or logged.
 */
export const TEST_DATABASE_URL =
  process.env['TEST_DATABASE_URL'] ??
  'postgresql://postgres:postgres@localhost:54329/trustedhands_test';

export const TEST_ENV: Record<string, string> = {
  NODE_ENV: 'test',
  DATABASE_URL: TEST_DATABASE_URL,
  DIRECT_URL: TEST_DATABASE_URL,
  JWT_SECRET: 'e2e-test-secret-not-used-anywhere-else-0123456789',
  EMAIL_PROVIDER: 'log',
  SMS_PROVIDER: 'log',
  CORS_ORIGINS: 'http://localhost:3001,http://localhost:3002',
  MOMO_TARGET_ENVIRONMENT: 'sandbox',
  MOMO_COLLECTION_CURRENCY: 'EUR',
  MOMO_DISBURSEMENT_CURRENCY: 'EUR',
};

/** Tests wipe and rebuild their database, so only ever run them against this machine. */
export function assertLocalDatabase(url: string): void {
  const host = new URL(url).hostname;
  if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
    throw new Error(
      `Refusing to run e2e tests against ${host}: they reset the database. Use the local Docker one (pnpm test:db:up).`,
    );
  }
}
