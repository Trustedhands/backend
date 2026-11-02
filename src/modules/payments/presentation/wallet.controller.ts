import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../../../shared/auth/auth-user.js';
import {
  CurrentUser,
  RequirePermission,
} from '../../../shared/auth/decorators.js';
import { WalletService } from '../application/wallet.service.js';
import {
  ClientWalletView,
  StartTopUpDto,
  WalletCreditDto,
  WalletTopUpView,
} from './wallet.views.js';

@ApiTags('wallet')
@ApiBearerAuth()
@Controller('wallet')
export class WalletController {
  constructor(private readonly wallet: WalletService) {}

  @Get()
  view(@CurrentUser() user: AuthUser): Promise<ClientWalletView> {
    return this.wallet.view(user.id);
  }

  /** Sends a MoMo prompt; poll GET /wallet/top-ups/:id until it leaves PENDING. */
  @Post('top-ups')
  topUp(
    @CurrentUser() user: AuthUser,
    @Body() dto: StartTopUpDto,
  ): Promise<WalletTopUpView> {
    return this.wallet.startTopUp(user.id, dto.amountRwf, dto.msisdn);
  }

  /** Also refreshes the status from MoMo while PENDING. */
  @Get('top-ups/:id')
  getTopUp(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<WalletTopUpView> {
    return this.wallet.topUp(user.id, id);
  }
}

@ApiTags('admin clients')
@ApiBearerAuth()
@Controller('admin/clients/:id/wallet')
export class AdminWalletController {
  constructor(private readonly wallet: WalletService) {}

  @RequirePermission('clients.view')
  @Get()
  view(@Param('id', ParseUUIDPipe) id: string): Promise<ClientWalletView> {
    return this.wallet.view(id);
  }

  /** Records money ops received for the client (cash, bank) or a goodwill credit. */
  @RequirePermission('payments.manage')
  @Post('credits')
  credit(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: WalletCreditDto,
  ): Promise<ClientWalletView> {
    return this.wallet.credit(user.id, id, dto.amountRwf, dto.note);
  }
}
