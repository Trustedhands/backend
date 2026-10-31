import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiExcludeEndpoint,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import type { AuthUser } from '../../../shared/auth/auth-user.js';
import {
  CurrentUser,
  Public,
  RequirePermission,
} from '../../../shared/auth/decorators.js';
import { FinanceService } from '../application/finance.service.js';
import {
  CreatePayoutDto,
  FailPayoutDto,
  FinanceOverviewView,
  IssueRefundDto,
  MarkPayoutPaidDto,
  PageQuery,
  PayoutsView,
  PayoutView,
  RefundView,
  TransactionPageView,
  WorkerWalletView,
} from './finance.dto.js';

@ApiTags('admin: finance')
@ApiBearerAuth()
@Controller('admin/finance')
export class AdminFinanceController {
  constructor(private readonly finance: FinanceService) {}

  @RequirePermission('payments.view')
  @Get('overview')
  overview(): Promise<FinanceOverviewView> {
    return this.finance.overview();
  }

  @RequirePermission('payments.view')
  @Get('transactions')
  transactions(@Query() q: PageQuery): Promise<TransactionPageView> {
    return this.finance.transactions({
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    });
  }

  /** "Export CSV" */
  @RequirePermission('payments.view')
  @Get('transactions.csv')
  @ApiProduces('text/csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header(
    'Content-Disposition',
    'attachment; filename="trustedhands-transactions.csv"',
  )
  transactionsCsv(): Promise<string> {
    return this.finance.transactionsCsv();
  }

  @RequirePermission('payments.view')
  @Get('refunds')
  refunds(): Promise<RefundView[]> {
    return this.finance.refunds();
  }

  /** "Issue refund": back to the payer's MoMo number */
  @RequirePermission('payments.manage')
  @Post('refunds')
  refund(
    @CurrentUser() user: AuthUser,
    @Body() dto: IssueRefundDto,
  ): Promise<RefundView> {
    return this.finance.issueRefund(user.id, dto);
  }

  /** Workers with a balance, and recent payouts */
  @RequirePermission('payments.view')
  @Get('payouts')
  payouts(): Promise<PayoutsView> {
    return this.finance.payouts();
  }

  /** "Pay out": MoMo goes out immediately; bank waits for confirmation */
  @RequirePermission('payments.manage')
  @Post('payouts')
  createPayout(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreatePayoutDto,
  ): Promise<PayoutView> {
    return this.finance.createPayout(user.id, dto);
  }

  @RequirePermission('payments.manage')
  @Post('payouts/:id/mark-paid')
  @HttpCode(200)
  markPaid(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MarkPayoutPaidDto,
  ): Promise<PayoutView> {
    return this.finance.markPayoutPaid(user.id, id, dto.reference);
  }

  @RequirePermission('payments.manage')
  @Post('payouts/:id/mark-failed')
  @HttpCode(200)
  markFailed(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: FailPayoutDto,
  ): Promise<PayoutView> {
    return this.finance.failBankPayout(user.id, id, dto.reason);
  }

  @RequirePermission('payments.view')
  @Get('workers/:id/wallet')
  wallet(@Param('id', ParseUUIDPipe) id: string): Promise<WorkerWalletView> {
    return this.finance.workerWallet(id);
  }
}

/**
 * MoMo Disbursement callbacks (MOMO_DSB_CALLBACK_URL/refunds/<id> and
 * /payouts/<id>). The body isn't trusted; it only triggers a status check.
 */
@Controller('webhooks/momo')
export class DisbursementWebhookController {
  constructor(private readonly finance: FinanceService) {}

  @Public()
  @ApiExcludeEndpoint()
  @Put('refunds/:id')
  @HttpCode(200)
  async refundPut(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.finance.syncRefund(id);
  }

  @Public()
  @ApiExcludeEndpoint()
  @Post('refunds/:id')
  @HttpCode(200)
  async refundPost(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.finance.syncRefund(id);
  }

  @Public()
  @ApiExcludeEndpoint()
  @Put('payouts/:id')
  @HttpCode(200)
  async payoutPut(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.finance.syncPayout(id);
  }

  @Public()
  @ApiExcludeEndpoint()
  @Post('payouts/:id')
  @HttpCode(200)
  async payoutPost(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.finance.syncPayout(id);
  }
}
