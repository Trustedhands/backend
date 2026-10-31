import { Module } from '@nestjs/common';
import { ServiceRequestsModule } from '../service-requests/service-requests.module.js';
import { OperationsService } from './application/operations.service.js';
import { OperationsController } from './presentation/operations.controller.js';

@Module({
  imports: [ServiceRequestsModule],
  controllers: [OperationsController],
  providers: [OperationsService],
})
export class OperationsModule {}
