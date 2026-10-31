import { Injectable } from '@nestjs/common';
import {
  randomBytes,
  scrypt,
  timingSafeEqual,
  type ScryptOptions,
} from 'node:crypto';

const scryptAsync = (
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
) =>
  new Promise<Buffer>((resolve, reject) =>
    scrypt(password, salt, keylen, options, (err, key) =>
      err ? reject(err) : resolve(key),
    ),
  );

// N=2^15, r=8 needs 32 MiB; raise maxmem to allow it
const PARAMS = { N: 2 ** 15, r: 8, p: 1 };
const KEY_LENGTH = 64;
const MAX_MEM = 64 * 1024 * 1024;

/** scrypt password hashing, stored as scrypt$N$r$p$salt$hash (base64url). */
@Injectable()
export class PasswordHasher {
  async hash(password: string): Promise<string> {
    const salt = randomBytes(16);
    const key = await scryptAsync(password, salt, KEY_LENGTH, {
      ...PARAMS,
      maxmem: MAX_MEM,
    });
    return [
      'scrypt',
      PARAMS.N,
      PARAMS.r,
      PARAMS.p,
      salt.toString('base64url'),
      key.toString('base64url'),
    ].join('$');
  }

  async verify(password: string, stored: string): Promise<boolean> {
    const [scheme, n, r, p, salt, hash] = stored.split('$');
    if (scheme !== 'scrypt' || !salt || !hash) return false;
    const expected = Buffer.from(hash, 'base64url');
    const actual = await scryptAsync(
      password,
      Buffer.from(salt, 'base64url'),
      expected.length,
      {
        N: Number(n),
        r: Number(r),
        p: Number(p),
        maxmem: MAX_MEM,
      },
    );
    return timingSafeEqual(actual, expected);
  }

  /** Burns comparable time when the account doesn't exist, so timing doesn't reveal it. */
  async dummyVerify(password: string): Promise<void> {
    await this.verify(password, DUMMY_HASH);
  }
}

const DUMMY_HASH =
  'scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA$' +
  Buffer.alloc(KEY_LENGTH).toString('base64url');
