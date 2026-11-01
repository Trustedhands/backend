import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import {
  LedgerEntryKind,
  PaymentStatus,
  PayoutMethod,
} from '../../../generated/prisma/enums.js';

export class FinanceOverviewView {
  /** Platform wallet: fees earned, less refunds it has borne */
  platformBalanceRwf: number;
  /** Fees released to the platform this month (Kigali time) */
  feesThisMonthRwf: number;
  /** Paid by clients, service not yet released */
  escrowRwf: number;
  /** Owed to workers across all wallets */
  workerWalletsRwf: number;
  workersWithBalance: number;
  payoutsPendingRwf: number;
  refundsPendingRwf: number;
}

export class TransactionRowView {
  paymentId: string;
  /** e.g. RC-10482 */
  receiptReference: string;
  paidAt: Date;
  clientName: string;
  serviceLabel: string;
  serviceRequestId: string;
  serviceRequestReference: string;
  amountRwf: number;
  /** Released to the worker, or what they'll get on release */
  workerShareRwf: number;
  feeRwf: number;
  refundedRwf: number;
  @ApiProperty({ enum: ['IN_ESCROW', 'SETTLED'] })
  status: 'IN_ESCROW' | 'SETTLED';
  /** Cancelled after payment: the worker gets nothing; unrefunded money goes to the platform */
  requestCancelled: boolean;
}

export class TransactionPageView {
  items: TransactionRowView[];
  total: number;
}

export class PageQuery {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize: number = 25;
}

export class WorkerBalanceView {
  workerId: string;
  fullName: string;
  balanceRwf: number;
  @ApiProperty({ enum: PayoutMethod, nullable: true })
  payoutMethod: PayoutMethod | null;
  /** e.g. "MoMo · 079 *** 2210" */
  destination: string | null;
}

export class PayoutView {
  id: string;
  workerId: string;
  workerName: string;
  amountRwf: number;
  @ApiProperty({ enum: PayoutMethod })
  method: PayoutMethod;
  destination: string;
  @ApiProperty({ enum: PaymentStatus })
  status: PaymentStatus;
  initiatedByName: string;
  manualReference: string | null;
  failureReason: string | null;
  createdAt: Date;
  completedAt: Date | null;
}

export class PayoutsView {
  /** Workers with money in their wallet */
  toPay: WorkerBalanceView[];
  /** Most recent first */
  payouts: PayoutView[];
}

export class CreatePayoutDto {
  @IsUUID()
  workerId: string;

  /** Defaults to the full balance */
  @IsOptional()
  @IsInt()
  @Min(1)
  amountRwf?: number;

  @ApiProperty({ enum: PayoutMethod })
  @IsEnum(PayoutMethod)
  method: PayoutMethod;
}

export class MarkPayoutPaidDto {
  /** Bank transfer reference */
  @IsString()
  @MinLength(3)
  @MaxLength(80)
  reference: string;
}

export class FailPayoutDto {
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason: string;
}

export class IssueRefundDto {
  @IsUUID()
  serviceRequestId: string;

  @IsInt()
  @Min(1)
  amountRwf: number;

  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason: string;

  /** The ticket it resolves */
  @IsOptional()
  @IsUUID()
  ticketId?: string;
}

export class RefundView {
  id: string;
  paymentId: string;
  serviceRequestId: string;
  serviceRequestReference: string;
  clientName: string;
  amountRwf: number;
  reason: string;
  @ApiProperty({ enum: PaymentStatus })
  status: PaymentStatus;
  @ApiProperty({ enum: ['ESCROW', 'PLATFORM'] })
  chargedTo: 'ESCROW' | 'PLATFORM';
  /** e.g. 078 *** 4567 */
  msisdnMasked: string;
  failureReason: string | null;
  ticketId: string | null;
  issuedByName: string;
  createdAt: Date;
  completedAt: Date | null;
}

export class WalletEntryView {
  id: string;
  @ApiProperty({ enum: LedgerEntryKind })
  kind: LedgerEntryKind;
  amountRwf: number;
  serviceRequestReference: string | null;
  at: Date;
}

export class WorkerWalletView {
  balanceRwf: number;
  entries: WalletEntryView[];
}
