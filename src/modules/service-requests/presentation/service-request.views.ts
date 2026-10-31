import { ApiProperty } from '@nestjs/swagger';
import { ReviewView } from '../../reviews/presentation/review.dto.js';
import {
  GenderPreference,
  Language,
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

/** A worker on a request: confirmed for clients; held or confirmed for ops. */
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

export class PlacementTermsView {
  @ApiProperty({ enum: ['LIVE_IN', 'LIVE_OUT'] })
  arrangement: 'LIVE_IN' | 'LIVE_OUT';
  daysPerWeek: number;
  /** Monthly salary the client has in mind; agreed between them and the worker */
  salaryRwf: number | null;
}

export class ServiceRequestSummaryView {
  id: string;
  /** e.g. SR-2048 */
  reference: string;
  /** Service type key, e.g. CLEANING */
  category: string;
  /** e.g. "Errands & groceries" */
  categoryLabel: string;
  @ApiProperty({ enum: ['VISIT', 'PLACEMENT'] })
  kind: 'VISIT' | 'PLACEMENT';
  description: string;
  /** Visit start, or placement start date */
  scheduledAt: Date;
  /** Visits only */
  durationHours: number | null;
  /** Placements only */
  placement: PlacementTermsView | null;
  @ApiProperty({ enum: ServiceRequestStatus })
  status: ServiceRequestStatus;
  totalRwf: number | null;
  /** Clients only see a worker once confirmed */
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
  @ApiProperty({ enum: ['INDIVIDUAL', 'COMPANY'] })
  accountType: 'INDIVIDUAL' | 'COMPANY';
  companyName: string | null;
  @ApiProperty({ enum: ['NOT_STARTED', 'PENDING', 'VERIFIED', 'REJECTED'] })
  kycStatus: 'NOT_STARTED' | 'PENDING' | 'VERIFIED' | 'REJECTED';
}

export class AdminServiceRequestSummaryView extends ServiceRequestSummaryView {
  client: ClientContactView;
  /** When the client was last reminded to pay */
  remindedAt: Date | null;
}

export class AdminServiceRequestDetailView extends ServiceRequestDetailView {
  client: ClientContactView;
  remindedAt: Date | null;
  version: number;
}

export class AdminServiceRequestPage {
  items: AdminServiceRequestSummaryView[];
  total: number;
  page: number;
  pageSize: number;
}

export class PipelineColumnView {
  @ApiProperty({ enum: ['NEW', 'PRICED', 'PAID', 'SCHEDULED', 'IN_PROGRESS'] })
  key: 'NEW' | 'PRICED' | 'PAID' | 'SCHEDULED' | 'IN_PROGRESS';
  count: number;
  /** Up to 50 cards, soonest first */
  cards: AdminServiceRequestSummaryView[];
}

export class PipelineView {
  columns: PipelineColumnView[];
}

export class WorkerConflictView {
  /** e.g. SR-2041 */
  reference: string;
  scheduledAt: Date;
}

/** A candidate on "Suggested workers", already sorted by the configured priority. */
export class SuggestedWorkerView {
  id: string;
  fullName: string;
  ratingAverage: number | null;
  completedJobs: number;
  @ApiProperty({ enum: Language, isArray: true })
  languages: Language[];
  categories: string[];
  district: string | null;
  sector: string | null;
  /** Straight-line distance; null when either location is unknown */
  distanceKm: number | null;
  available: boolean;
  /** The booking that clashes, when not available */
  conflict: WorkerConflictView | null;
  languageMatch: boolean;
  genderMatch: boolean;
  /** Currently held or confirmed on this request */
  isAssigned: boolean;
}
