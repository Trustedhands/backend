import { Module } from '@nestjs/common';
import { ConfigurationModule } from '../configuration/configuration.module.js';
import { ServiceRequestsModule } from '../service-requests/service-requests.module.js';
import { MobileMoneyGateway } from './application/mobile-money.gateway.js';
import { MoneyTransferGateway } from './application/money-transfer.gateway.js';
import { PaymentsService } from './application/payments.service.js';
import { WalletService } from './application/wallet.service.js';
import { PaymentRepository } from './domain/payment.repository.js';
import { MtnMomoTransfers } from './infrastructure/mtn-momo-transfers.js';
import { MtnMomoGateway } from './infrastructure/mtn-momo.gateway.js';
import { PaymentQueries } from './infrastructure/payment.queries.js';
import { PrismaPaymentRepository } from './infrastructure/prisma-payment.repository.js';
import {
  MomoWebhookController,
  PaymentsController,
} from './presentation/payments.controller.js';
import {
  AdminWalletController,
  WalletController,
} from './presentation/wallet.controller.js';

@Module({
  imports: [ServiceRequestsModule, ConfigurationModule],
  controllers: [
    PaymentsController,
    MomoWebhookController,
    WalletController,
    AdminWalletController,
  ],
  providers: [
    PaymentsService,
    WalletService,
    PaymentQueries,
    { provide: PaymentRepository, useClass: PrismaPaymentRepository },
    { provide: MobileMoneyGateway, useClass: MtnMomoGateway },
    { provide: MoneyTransferGateway, useClass: MtnMomoTransfers },
  ],
  exports: [PaymentsService, WalletService, MoneyTransferGateway],
})
export class PaymentsModule {}
