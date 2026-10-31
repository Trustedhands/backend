import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthGuard } from './auth.guard.js';
import { RolesGuard } from './roles.guard.js';
import { AccessTokens } from './access-tokens.js';

@Global()
@Module({
  providers: [
    AccessTokens,
    // Order matters: authenticate first, then check roles.
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
  exports: [AccessTokens],
})
export class AuthModule {}
