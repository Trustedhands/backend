import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { Env } from '../../config/env.js';
import type { AuthUser } from './auth-user.js';

/**
 * Verifies Supabase Auth access tokens against the project's published
 * signing keys (asymmetric, so no shared secret is needed). jose caches the
 * key set and refetches it when it sees an unknown `kid`.
 */
@Injectable()
export class SupabaseTokenVerifier {
  private readonly jwks: ReturnType<typeof createRemoteJWKSet>;
  private readonly issuer: string;

  constructor(config: ConfigService<Env, true>) {
    const supabaseUrl = config
      .get('SUPABASE_URL', { infer: true })
      .replace(/\/$/, '');
    this.issuer = `${supabaseUrl}/auth/v1`;
    this.jwks = createRemoteJWKSet(
      new URL(`${this.issuer}/.well-known/jwks.json`),
    );
  }

  async verify(token: string): Promise<AuthUser> {
    const { payload } = await jwtVerify(token, this.jwks, {
      issuer: this.issuer,
      audience: 'authenticated',
    });
    if (!payload.sub) {
      throw new Error('Token has no subject');
    }
    return {
      id: payload.sub,
      email:
        typeof payload['email'] === 'string' && payload['email']
          ? payload['email']
          : null,
      phone:
        typeof payload['phone'] === 'string' && payload['phone']
          ? payload['phone']
          : null,
    };
  }
}
