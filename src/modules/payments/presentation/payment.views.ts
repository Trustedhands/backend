import { ApiProperty } from '@nestjs/swagger';
import {
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class InitiatePaymentDto {
  /** WALLET pays from the client's wallet balance at once */
  @ApiProperty({
    enum: ['MTN_MOMO', 'WALLET'],
    default: 'MTN_MOMO',
    required: false,
  })
  @IsOptional()
  @IsIn(['MTN_MOMO', 'WALLET'])
  method: 'MTN_MOMO' | 'WALLET' = 'MTN_MOMO';

  /** MTN Mobile Money number, e.g. 078 123 4567; required unless paying from the wallet */
  @ValidateIf((dto: InitiatePaymentDto) => dto.method !== 'WALLET')
  @IsString()
  @MinLength(9)
  @MaxLength(20)
  msisdn?: string;
}

export class PaymentView {
  id: string;
  /** e.g. RC-10482; only meaningful once SUCCESSFUL */
  receiptReference: string;
  serviceRequestId: string;
  amountRwf: number;
  @ApiProperty({ enum: ['PENDING', 'SUCCESSFUL', 'FAILED'] })
  status: 'PENDING' | 'SUCCESSFUL' | 'FAILED';
  @ApiProperty({ enum: ['MTN_MOMO', 'WALLET'] })
  method: 'MTN_MOMO' | 'WALLET';
  /** e.g. 078 *** 4567; null for wallet payments */
  msisdnMasked: string | null;
  failureReason: string | null;
  createdAt: Date;
  completedAt: Date | null;
}

export class TransactionView {
  id: string;
  @ApiProperty({ enum: ['PAYMENT', 'REFUND'] })
  kind: 'PAYMENT' | 'REFUND';
  /** Service type key */
  category: string;
  categoryLabel: string;
  serviceRequestReference: string;
  receiptReference: string | null;
  /** Always positive; `kind` gives the direction */
  amountRwf: number;
  /** Refunds go back to the payer's MoMo number: PENDING, then REFUNDED */
  @ApiProperty({ enum: ['PENDING', 'SUCCESSFUL', 'FAILED', 'REFUNDED'] })
  status: 'PENDING' | 'SUCCESSFUL' | 'FAILED' | 'REFUNDED';
  at: Date;
}

export class PaymentHistoryView {
  /** Successful payments in the current month (Africa/Kigali) */
  monthSpentRwf: number;
  monthPaymentCount: number;
  walletBalanceRwf: number;
  transactions: TransactionView[];
}
