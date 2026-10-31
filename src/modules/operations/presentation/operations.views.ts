import { ApiProperty } from '@nestjs/swagger';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { WorkerStatus } from '../../../generated/prisma/enums.js';
import { AdminServiceRequestSummaryView } from '../../service-requests/presentation/service-request.views.js';

export class DashboardCountsView {
  /** New and adjustment-requested, to price & match */
  newCount: number;
  /** Minutes the oldest new request has waited; null when none */
  oldestNewWaitingMinutes: number | null;
  pricedCount: number;
  paidCount: number;
  servicesToday: number;
  inProgressNow: number;
  openTickets: number;
  activeTickets: number;
}

export class WorkerToVerifyView {
  id: string;
  fullName: string;
  categories: string[];
  createdByName: string | null;
  createdAt: Date;
}

export class DashboardView {
  counts: DashboardCountsView;
  needsAction: AdminServiceRequestSummaryView[];
  workersToVerify: WorkerToVerifyView[];
}

export class SearchQuery {
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  q: string;
}

export class SearchWorkerView {
  id: string;
  fullName: string;
  @ApiProperty({ enum: WorkerStatus })
  status: WorkerStatus;
  phone: string;
}

export class SearchClientView {
  id: string;
  fullName: string;
  email: string;
  phone: string | null;
}

export class SearchResultsView {
  requests: AdminServiceRequestSummaryView[];
  workers: SearchWorkerView[];
  clients: SearchClientView[];
}

export class ListClientsQuery {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  q?: string;

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

export class ClientListItemView {
  id: string;
  fullName: string;
  email: string;
  phone: string | null;
  @ApiProperty({ enum: ['INDIVIDUAL', 'COMPANY'] })
  accountType: 'INDIVIDUAL' | 'COMPANY';
  companyName: string | null;
  @ApiProperty({ enum: ['NOT_STARTED', 'PENDING', 'VERIFIED', 'REJECTED'] })
  kycStatus: 'NOT_STARTED' | 'PENDING' | 'VERIFIED' | 'REJECTED';
  emailVerified: boolean;
  phoneVerified: boolean;
  requestCount: number;
  createdAt: Date;
}

export class ClientPageView {
  items: ClientListItemView[];
  total: number;
}

export class ClientDetailView extends ClientListItemView {
  district: string | null;
  sector: string | null;
  street: string | null;
  recentRequests: AdminServiceRequestSummaryView[];
  openTicketCount: number;
}
