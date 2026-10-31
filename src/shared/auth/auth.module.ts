import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthGuard } from './auth.guard.js';
import { RolesGuard } from './roles.guard.js';
import { SupabaseTokenVerifier } from './supabase-token.verifier.js';

@Global()
@Module({
  providers: [
    SupabaseTokenVerifier,
    // Order matters: authenticate first, then check roles.
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
  exports: [SupabaseTokenVerifier],
})
export class AuthModule {}
