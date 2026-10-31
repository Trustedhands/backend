import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnv } from './config/env.js';
import { HealthController } from './health/health.controller.js';
import { IdentityModule } from './modules/identity/identity.module.js';
import { PaymentsModule } from './modules/payments/payments.module.js';
import { ServiceRequestsModule } from './modules/service-requests/service-requests.module.js';
import { WorkersModule } from './modules/workers/workers.module.js';
import { AuthModule } from './shared/auth/auth.module.js';
import { DatabaseModule } from './shared/database/database.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnv,
    }),
    DatabaseModule,
    AuthModule,
    IdentityModule,
    WorkersModule,
    ServiceRequestsModule,
    PaymentsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
