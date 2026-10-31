import { Module } from '@nestjs/common';
import { ServiceRequestsModule } from '../service-requests/service-requests.module.js';
import { MobileMoneyGateway } from './application/mobile-money.gateway.js';
import { PaymentsService } from './application/payments.service.js';
import { PaymentRepository } from './domain/payment.repository.js';
import { MtnMomoGateway } from './infrastructure/mtn-momo.gateway.js';
import { PaymentQueries } from './infrastructure/payment.queries.js';
import { PrismaPaymentRepository } from './infrastructure/prisma-payment.repository.js';
import {
  MomoWebhookController,
  PaymentsController,
} from './presentation/payments.controller.js';

@Module({
  imports: [ServiceRequestsModule],
  controllers: [PaymentsController, MomoWebhookController],
  providers: [
    PaymentsService,
    PaymentQueries,
    { provide: PaymentRepository, useClass: PrismaPaymentRepository },
    { provide: MobileMoneyGateway, useClass: MtnMomoGateway },
  ],
})
export class PaymentsModule {}
