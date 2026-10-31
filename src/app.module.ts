import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnv } from './config/env.js';
import { HealthController } from './health/health.controller.js';
import { AuthAccountsModule } from './modules/auth/auth.module.js';
import { ConfigurationModule } from './modules/configuration/configuration.module.js';
import { IdentityModule } from './modules/identity/identity.module.js';
import { OperationsModule } from './modules/operations/operations.module.js';
import { PaymentsModule } from './modules/payments/payments.module.js';
import { ReviewsModule } from './modules/reviews/reviews.module.js';
import { ServiceRequestsModule } from './modules/service-requests/service-requests.module.js';
import { SupportModule } from './modules/support/support.module.js';
import { TeamModule } from './modules/team/team.module.js';
import { WorkersModule } from './modules/workers/workers.module.js';
import { AuditModule } from './shared/audit/audit-log.js';
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
    AuditModule,
    ConfigurationModule,
    TeamModule,
    AuthAccountsModule,
    IdentityModule,
    WorkersModule,
    ServiceRequestsModule,
    PaymentsModule,
    ReviewsModule,
    OperationsModule,
    SupportModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
