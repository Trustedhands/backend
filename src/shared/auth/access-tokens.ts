import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { jwtVerify, SignJWT } from 'jose';
import type { Env } from '../../config/env.js';
import type { AuthUser } from './auth-user.js';

const ISSUER = 'trustedhands-api';
const AUDIENCE = 'trustedhands';
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;

/**
 * Short-lived HS256 access tokens. They carry only the user id; roles are
 * read from the database per request so revocation is immediate.
 */
@Injectable()
export class AccessTokens {
  private readonly key: Uint8Array;

  constructor(config: ConfigService<Env, true>) {
    this.key = new TextEncoder().encode(
      config.get('JWT_SECRET', { infer: true }),
    );
  }

  sign(userId: string): Promise<string> {
    return new SignJWT({})
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(userId)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(`${ACCESS_TOKEN_TTL_SECONDS}s`)
      .sign(this.key);
  }

  async verify(token: string): Promise<AuthUser> {
    const { payload } = await jwtVerify(token, this.key, {
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithms: ['HS256'],
    });
    if (!payload.sub) throw new Error('Token has no subject');
    return { id: payload.sub };
  }
}
