import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
} from '@nestjs/common';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../../../shared/auth/auth-user.js';
import { CurrentUser, Public } from '../../../shared/auth/decorators.js';
import { PaymentsService } from '../application/payments.service.js';
import { PaymentQueries } from '../infrastructure/payment.queries.js';
import {
  InitiatePaymentDto,
  PaymentHistoryView,
  PaymentView,
} from './payment.views.js';

@ApiTags('payments')
@ApiBearerAuth()
@Controller()
export class PaymentsController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly queries: PaymentQueries,
  ) {}

  /**
   * "Accept & pay". Sends a MoMo prompt to the payer's phone; poll
   * GET /payments/:id until the status leaves PENDING.
   */
  @Post('service-requests/:id/payments')
  async initiate(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) serviceRequestId: string,
    @Body() dto: InitiatePaymentDto,
  ): Promise<PaymentView> {
    return this.queries.view(
      await this.payments.initiate(user.id, serviceRequestId, dto.msisdn),
    );
  }

  @Get('payments')
  history(@CurrentUser() user: AuthUser): Promise<PaymentHistoryView> {
    return this.queries.history(user.id);
  }

  /** Also refreshes the status from MoMo while PENDING. */
  @Get('payments/:id')
  async get(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PaymentView> {
    return this.queries.view(await this.payments.getForClient(user.id, id));
  }
}

/** MoMo calls back here (X-Callback-Url = MOMO_CALLBACK_URL/<paymentId>). */
@Controller('webhooks/momo')
export class MomoWebhookController {
  constructor(private readonly payments: PaymentsService) {}

  @Public()
  @ApiExcludeEndpoint()
  @Put(':paymentId')
  @HttpCode(200)
  async callbackPut(
    @Param('paymentId', ParseUUIDPipe) paymentId: string,
  ): Promise<void> {
    await this.payments.handleProviderCallback(paymentId);
  }

  @Public()
  @ApiExcludeEndpoint()
  @Post(':paymentId')
  @HttpCode(200)
  async callbackPost(
    @Param('paymentId', ParseUUIDPipe) paymentId: string,
  ): Promise<void> {
    await this.payments.handleProviderCallback(paymentId);
  }
}
