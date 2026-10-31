import { Module } from '@nestjs/common';
import { FinanceModule } from '../finance/finance.module.js';
import { ServiceRequestsModule } from '../service-requests/service-requests.module.js';
import { OperationsService } from './application/operations.service.js';
import { OperationsController } from './presentation/operations.controller.js';

@Module({
  imports: [ServiceRequestsModule, FinanceModule],
  controllers: [OperationsController],
  providers: [OperationsService],
})
export class OperationsModule {}
