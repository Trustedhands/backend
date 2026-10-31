import { ApiProperty } from '@nestjs/swagger';
import { ReviewView } from '../../reviews/presentation/review.dto.js';
import {
  GenderPreference,
  Language,
  ServiceCategory,
  ServiceRequestStatus,
} from '../domain/service-request.js';

export class ServiceAddressView {
  district: string;
  sector: string;
  street: string;
  latitude: number | null;
  longitude: number | null;
}

export class QuoteView {
  workerFeeRwf: number;
  serviceFeeRwf: number;
  discountRwf: number;
  totalRwf: number;
  note: string | null;
  pricedAt: Date;
}

/** What a client sees about their assigned worker. */
export class AssignedWorkerView {
  id: string;
  fullName: string;
  @ApiProperty({ enum: Language, isArray: true })
  languages: Language[];
  idVerified: boolean;
  ratingAverage: number | null;
  completedJobs: number;
}

export class TimelineEntryView {
  @ApiProperty({ enum: ServiceRequestStatus })
  status: ServiceRequestStatus;
  note: string | null;
  at: Date;
}

export class PaymentBriefView {
  id: string;
  /** e.g. RC-10482 */
  receiptReference: string;
  amountRwf: number;
  completedAt: Date | null;
}

export class ServiceRequestSummaryView {
  id: string;
  /** e.g. SR-2048 */
  reference: string;
  @ApiProperty({ enum: ServiceCategory })
  category: ServiceCategory;
  description: string;
  scheduledAt: Date;
  durationHours: number;
  @ApiProperty({ enum: ServiceRequestStatus })
  status: ServiceRequestStatus;
  totalRwf: number | null;
  worker: AssignedWorkerView | null;
  createdAt: Date;
}

export class ServiceRequestDetailView extends ServiceRequestSummaryView {
  @ApiProperty({ enum: GenderPreference })
  preferredGender: GenderPreference;
  @ApiProperty({ enum: Language, isArray: true })
  preferredLanguages: Language[];
  address: ServiceAddressView;
  quote: QuoteView | null;
  adjustmentNote: string | null;
  cancellationReason: string | null;
  completedAt: Date | null;
  timeline: TimelineEntryView[];
  payment: PaymentBriefView | null;
  hasPendingPayment: boolean;
  hasReview: boolean;
  /** The client's review, once submitted */
  review: ReviewView | null;
}

export class ClientContactView {
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
}

export class AdminServiceRequestSummaryView extends ServiceRequestSummaryView {
  client: ClientContactView;
}

export class AdminServiceRequestDetailView extends ServiceRequestDetailView {
  client: ClientContactView;
  version: number;
}

export class AdminServiceRequestPage {
  items: AdminServiceRequestSummaryView[];
  total: number;
  page: number;
  pageSize: number;
}
