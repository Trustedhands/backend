import { Module } from '@nestjs/common';
import { ConfigurationModule } from '../configuration/configuration.module.js';
import { PaymentsModule } from '../payments/payments.module.js';
import { ServiceRequestsModule } from '../service-requests/service-requests.module.js';
import { FinanceService } from './application/finance.service.js';
import { SettlementJob } from './application/settlement.job.js';
import {
  AdminFinanceController,
  DisbursementWebhookController,
} from './presentation/finance.controller.js';
import { SettlementController } from './presentation/settlement.controller.js';

@Module({
  imports: [PaymentsModule, ServiceRequestsModule, ConfigurationModule],
  controllers: [
    AdminFinanceController,
    DisbursementWebhookController,
    SettlementController,
  ],
  providers: [FinanceService, SettlementJob],
  exports: [FinanceService],
})
export class FinanceModule {}
