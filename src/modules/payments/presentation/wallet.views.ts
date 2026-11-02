import { ApiProperty } from '@nestjs/swagger';
import {
  IsInt,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import {
  MAX_WALLET_AMOUNT_RWF,
  MIN_WALLET_AMOUNT_RWF,
} from '../domain/wallet.js';

export class StartTopUpDto {
  @IsInt()
  @Min(MIN_WALLET_AMOUNT_RWF)
  @Max(MAX_WALLET_AMOUNT_RWF)
  amountRwf: number;

  /** MTN Mobile Money number to charge, e.g. 078 123 4567 */
  @IsString()
  @MinLength(9)
  @MaxLength(20)
  msisdn: string;
}

export class WalletCreditDto {
  @IsInt()
  @Min(MIN_WALLET_AMOUNT_RWF)
  @Max(MAX_WALLET_AMOUNT_RWF)
  amountRwf: number;

  /** Why, e.g. "Cash received at the office" */
  @IsString()
  @MinLength(3)
  @MaxLength(300)
  note: string;
}

export class WalletTopUpView {
  id: string;
  amountRwf: number;
  @ApiProperty({ enum: ['PENDING', 'SUCCESSFUL', 'FAILED'] })
  status: 'PENDING' | 'SUCCESSFUL' | 'FAILED';
  /** e.g. 078 *** 4567 */
  msisdnMasked: string;
  failureReason: string | null;
  createdAt: Date;
  completedAt: Date | null;
}

export class ClientWalletEntryView {
  id: string;
  @ApiProperty({
    enum: ['TOP_UP', 'ADJUSTMENT', 'PAYMENT_DEBIT', 'REFUND_CREDIT'],
  })
  type: 'TOP_UP' | 'ADJUSTMENT' | 'PAYMENT_DEBIT' | 'REFUND_CREDIT';
  /** e.g. "Top-up from Mobile Money", "Payment for SR-1042" */
  label: string;
  /** Positive for money in, negative for money out */
  amountRwf: number;
  serviceRequestReference: string | null;
  /** Ops credits: the reason given */
  note: string | null;
  /** Ops credits: who added it */
  createdByName: string | null;
  at: Date;
}

export class ClientWalletView {
  balanceRwf: number;
  /** Settings → Client wallet; when off, clients can't top up or pay from it */
  enabled: boolean;
  pendingTopUps: WalletTopUpView[];
  /** Newest first, up to 100 */
  entries: ClientWalletEntryView[];
}
