import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { ServiceCategory } from '../../service-requests/domain/service-request.js';

export class InitiatePaymentDto {
  /** MTN Mobile Money number, e.g. 078 123 4567 */
  @IsString()
  @MinLength(9)
  @MaxLength(20)
  msisdn: string;
}

export class PaymentView {
  id: string;
  /** e.g. RC-10482; only meaningful once SUCCESSFUL */
  receiptReference: string;
  serviceRequestId: string;
  amountRwf: number;
  @ApiProperty({ enum: ['PENDING', 'SUCCESSFUL', 'FAILED'] })
  status: 'PENDING' | 'SUCCESSFUL' | 'FAILED';
  /** e.g. 078 *** 4567 */
  msisdnMasked: string;
  failureReason: string | null;
  createdAt: Date;
  completedAt: Date | null;
}

export class TransactionView {
  id: string;
  @ApiProperty({ enum: ['PAYMENT', 'REFUND'] })
  kind: 'PAYMENT' | 'REFUND';
  @ApiProperty({ enum: ServiceCategory })
  category: ServiceCategory;
  serviceRequestReference: string;
  receiptReference: string | null;
  /** Always positive; `kind` gives the direction */
  amountRwf: number;
  @ApiProperty({ enum: ['PENDING', 'SUCCESSFUL', 'FAILED', 'CREDITED'] })
  status: 'PENDING' | 'SUCCESSFUL' | 'FAILED' | 'CREDITED';
  at: Date;
}

export class PaymentHistoryView {
  /** Successful payments in the current month (Africa/Kigali) */
  monthSpentRwf: number;
  monthPaymentCount: number;
  walletBalanceRwf: number;
  transactions: TransactionView[];
}
