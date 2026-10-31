import 'reflect-metadata';
import { validateEnv } from './env.js';

const base = {
  DATABASE_URL: 'postgres://localhost/test',
  JWT_SECRET: 'x'.repeat(32),
};

describe('validateEnv', () => {
  it('reads the number of trusted proxies', () => {
    expect(validateEnv(base).TRUST_PROXY_HOPS).toBe(0);
    expect(
      validateEnv({ ...base, TRUST_PROXY_HOPS: '1' }).TRUST_PROXY_HOPS,
    ).toBe(1);
  });

  it('requires RWF for live MoMo', () => {
    expect(() =>
      validateEnv({ ...base, MOMO_TARGET_ENVIRONMENT: 'mtnrwanda' }),
    ).toThrow(/must use RWF/);
    expect(() =>
      validateEnv({
        ...base,
        MOMO_TARGET_ENVIRONMENT: 'mtnrwanda',
        MOMO_COLLECTION_CURRENCY: 'RWF',
        MOMO_DISBURSEMENT_CURRENCY: 'RWF',
      }),
    ).not.toThrow();
  });
});
