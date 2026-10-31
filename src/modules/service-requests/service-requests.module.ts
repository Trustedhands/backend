import { Module } from '@nestjs/common';
import { AuthAccountsModule } from '../auth/auth.module.js';
import { ConfigurationModule } from '../configuration/configuration.module.js';
import { IdentityModule } from '../identity/identity.module.js';
import { WorkersModule } from '../workers/workers.module.js';
import { MatchingService } from './application/matching.service.js';
import { ServiceRequestsService } from './application/service-requests.service.js';
import { ServiceRequestRepository } from './domain/service-request.repository.js';
import { PrismaServiceRequestRepository } from './infrastructure/prisma-service-request.repository.js';
import { ServiceRequestQueries } from './infrastructure/service-request.queries.js';
import { AdminServiceRequestsController } from './presentation/admin-service-requests.controller.js';
import { ServiceRequestsController } from './presentation/service-requests.controller.js';

@Module({
  imports: [
    IdentityModule,
    WorkersModule,
    ConfigurationModule,
    AuthAccountsModule,
  ],
  controllers: [ServiceRequestsController, AdminServiceRequestsController],
  providers: [
    ServiceRequestsService,
    MatchingService,
    ServiceRequestQueries,
    {
      provide: ServiceRequestRepository,
      useClass: PrismaServiceRequestRepository,
    },
  ],
  exports: [ServiceRequestRepository, ServiceRequestQueries],
})
export class ServiceRequestsModule {}
