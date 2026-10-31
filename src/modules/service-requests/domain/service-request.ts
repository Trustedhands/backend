import { randomUUID } from 'node:crypto';
import {
  ConflictError,
  InvalidInputError,
} from '../../../shared/domain/domain-error.js';

export const ServiceRequestStatus = {
  REQUESTED: 'REQUESTED',
  PRICED: 'PRICED',
  ADJUSTMENT_REQUESTED: 'ADJUSTMENT_REQUESTED',
  PAID: 'PAID',
  ASSIGNED: 'ASSIGNED',
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
} as const;
export type ServiceRequestStatus =
  (typeof ServiceRequestStatus)[keyof typeof ServiceRequestStatus];

export const ServiceCategory = {
  CLEANING: 'CLEANING',
  COOKING: 'COOKING',
  ERRANDS: 'ERRANDS',
  REPAIRS: 'REPAIRS',
  LAUNDRY: 'LAUNDRY',
  DRIVER: 'DRIVER',
  OTHER: 'OTHER',
} as const;
export type ServiceCategory =
  (typeof ServiceCategory)[keyof typeof ServiceCategory];

export const GenderPreference = {
  ANY: 'ANY',
  FEMALE: 'FEMALE',
  MALE: 'MALE',
} as const;
export type GenderPreference =
  (typeof GenderPreference)[keyof typeof GenderPreference];

export const Language = { EN: 'EN', FR: 'FR', RW: 'RW', SW: 'SW' } as const;
export type Language = (typeof Language)[keyof typeof Language];

/** Statuses a client sees under "Active" in My requests. */
export const ACTIVE_STATUSES: readonly ServiceRequestStatus[] = [
  'REQUESTED',
  'PRICED',
  'ADJUSTMENT_REQUESTED',
  'PAID',
  'ASSIGNED',
  'IN_PROGRESS',
];

const CLIENT_CANCELLABLE: readonly ServiceRequestStatus[] = [
  'REQUESTED',
  'PRICED',
  'ADJUSTMENT_REQUESTED',
];
/** Ops can also cancel after payment; refunding is a separate step. */
const ADMIN_CANCELLABLE: readonly ServiceRequestStatus[] = [
  ...CLIENT_CANCELLABLE,
  'PAID',
  'ASSIGNED',
];

const MAX_DESCRIPTION_LENGTH = 2000;
const MIN_DURATION_HOURS = 0.5;
const MAX_DURATION_HOURS = 12;

export interface ServiceAddress {
  district: string;
  sector: string;
  street: string;
  latitude: number | null;
  longitude: number | null;
}

export interface Quote {
  workerFeeRwf: number;
  serviceFeeRwf: number;
  note: string | null;
  pricedAt: Date;
}

export interface ServiceRequestProps {
  id: string;
  /** Assigned by the database on insert; null until persisted. */
  number: number | null;
  clientId: string;
  category: ServiceCategory;
  description: string;
  scheduledAt: Date;
  durationHours: number;
  preferredGender: GenderPreference;
  preferredLanguages: Language[];
  address: ServiceAddress;
  status: ServiceRequestStatus;
  quote: Quote | null;
  discountRwf: number;
  adjustmentNote: string | null;
  assignedWorkerId: string | null;
  cancellationReason: string | null;
  completedAt: Date | null;
  version: number;
  createdAt: Date;
}

export interface SubmitServiceRequest {
  clientId: string;
  category: ServiceCategory;
  description: string;
  scheduledAt: Date;
  durationHours: number;
  preferredGender: GenderPreference;
  preferredLanguages: Language[];
  address: ServiceAddress;
}

/** A recorded lifecycle change, persisted as the request's timeline. */
export interface StatusChange {
  status: ServiceRequestStatus;
  actorId: string | null;
  note: string | null;
  at: Date;
}

/**
 * Aggregate root for a client's request for help.
 *
 * Lifecycle (ops-mediated: the TrustedHands team prices and assigns):
 *   REQUESTED → PRICED ⇄ ADJUSTMENT_REQUESTED
 *   PRICED → PAID → ASSIGNED → IN_PROGRESS → COMPLETED
 * Cancellation is possible before completion, with stricter rules for clients.
 */
export class ServiceRequest {
  private changes: StatusChange[] = [];

  private constructor(private props: ServiceRequestProps) {}

  static submit(input: SubmitServiceRequest, now = new Date()): ServiceRequest {
    const description = input.description.trim();
    if (!description) {
      throw new InvalidInputError('description_required', 'Describe the job');
    }
    if (description.length > MAX_DESCRIPTION_LENGTH) {
      throw new InvalidInputError(
        'description_too_long',
        `Description must be at most ${MAX_DESCRIPTION_LENGTH} characters`,
      );
    }
    if (
      input.durationHours < MIN_DURATION_HOURS ||
      input.durationHours > MAX_DURATION_HOURS ||
      !Number.isInteger(input.durationHours * 2)
    ) {
      throw new InvalidInputError(
        'invalid_duration',
        `Duration must be between ${MIN_DURATION_HOURS} and ${MAX_DURATION_HOURS} hours, in half-hour steps`,
      );
    }
    if (input.scheduledAt.getTime() <= now.getTime()) {
      throw new InvalidInputError(
        'schedule_in_past',
        'Choose a date and time in the future',
      );
    }

    const request = new ServiceRequest({
      id: randomUUID(),
      number: null,
      clientId: input.clientId,
      category: input.category,
      description,
      scheduledAt: input.scheduledAt,
      durationHours: input.durationHours,
      preferredGender: input.preferredGender,
      preferredLanguages: [...new Set(input.preferredLanguages)],
      address: input.address,
      status: 'REQUESTED',
      quote: null,
      discountRwf: 0,
      adjustmentNote: null,
      assignedWorkerId: null,
      cancellationReason: null,
      completedAt: null,
      version: 0,
      createdAt: now,
    });
    request.record('REQUESTED', input.clientId, null, now);
    return request;
  }

  static rehydrate(props: ServiceRequestProps): ServiceRequest {
    return new ServiceRequest({ ...props });
  }

  get id() {
    return this.props.id;
  }
  get number() {
    return this.props.number;
  }
  get clientId() {
    return this.props.clientId;
  }
  get status() {
    return this.props.status;
  }
  get quote() {
    return this.props.quote;
  }
  get assignedWorkerId() {
    return this.props.assignedWorkerId;
  }
  get version() {
    return this.props.version;
  }

  /** What the client pays: worker fee + platform fee − discount. Null until priced. */
  get totalRwf(): number | null {
    const { quote, discountRwf } = this.props;
    if (!quote) return null;
    return Math.max(0, quote.workerFeeRwf + quote.serviceFeeRwf - discountRwf);
  }

  isOwnedBy(clientId: string): boolean {
    return this.props.clientId === clientId;
  }

  /** Ops sends (or revises) the price. */
  price(
    input: {
      workerFeeRwf: number;
      serviceFeeRwf: number;
      note?: string | null;
    },
    actorId: string,
    now = new Date(),
  ): void {
    this.assertStatus(['REQUESTED', 'ADJUSTMENT_REQUESTED', 'PRICED'], 'price');
    for (const [name, value] of Object.entries({
      workerFeeRwf: input.workerFeeRwf,
      serviceFeeRwf: input.serviceFeeRwf,
    })) {
      if (!Number.isInteger(value) || value < 0) {
        throw new InvalidInputError(
          'invalid_fee',
          `${name} must be a whole, non-negative amount`,
        );
      }
    }
    if (input.workerFeeRwf + input.serviceFeeRwf <= 0) {
      throw new InvalidInputError(
        'invalid_fee',
        'The total price must be greater than zero',
      );
    }

    this.props.quote = {
      workerFeeRwf: input.workerFeeRwf,
      serviceFeeRwf: input.serviceFeeRwf,
      note: input.note?.trim() || null,
      pricedAt: now,
    };
    this.props.adjustmentNote = null;
    this.props.status = 'PRICED';
    this.record('PRICED', actorId, this.props.quote.note, now);
  }

  /** Client: "Not right? Ask us to adjust". */
  requestAdjustment(note: string, actorId: string, now = new Date()): void {
    this.assertStatus(['PRICED'], 'request an adjustment');
    const trimmed = note.trim();
    if (!trimmed) {
      throw new InvalidInputError(
        'adjustment_note_required',
        'Tell us what should change',
      );
    }
    this.props.adjustmentNote = trimmed;
    this.props.status = 'ADJUSTMENT_REQUESTED';
    this.record('ADJUSTMENT_REQUESTED', actorId, trimmed, now);
  }

  /** Called when the client's payment for the current price succeeds. */
  markPaid(amountRwf: number, now = new Date()): void {
    this.assertStatus(['PRICED'], 'mark as paid');
    if (amountRwf !== this.totalRwf) {
      throw new ConflictError(
        'payment_amount_mismatch',
        `Paid ${amountRwf} RWF but the current price is ${this.totalRwf} RWF`,
      );
    }
    this.props.status = 'PAID';
    this.record('PAID', null, null, now);
  }

  /** Ops assigns a worker after payment; can reassign until work starts. */
  assignWorker(workerId: string, actorId: string, now = new Date()): void {
    this.assertStatus(['PAID', 'ASSIGNED'], 'assign a worker');
    if (this.props.assignedWorkerId === workerId) return;
    const reassigning = this.props.status === 'ASSIGNED';
    this.props.assignedWorkerId = workerId;
    this.props.status = 'ASSIGNED';
    this.record(
      'ASSIGNED',
      actorId,
      reassigning ? 'Worker reassigned' : null,
      now,
    );
  }

  start(actorId: string, now = new Date()): void {
    this.assertStatus(['ASSIGNED'], 'start');
    this.props.status = 'IN_PROGRESS';
    this.record('IN_PROGRESS', actorId, null, now);
  }

  /** Client "Mark as done", or ops closing the job. */
  complete(actorId: string, now = new Date()): void {
    this.assertStatus(['ASSIGNED', 'IN_PROGRESS'], 'complete');
    this.props.status = 'COMPLETED';
    this.props.completedAt = now;
    this.record('COMPLETED', actorId, null, now);
  }

  cancel(
    reason: string,
    actor: { id: string; isAdmin: boolean },
    now = new Date(),
  ): void {
    this.assertStatus(
      actor.isAdmin ? ADMIN_CANCELLABLE : CLIENT_CANCELLABLE,
      'cancel',
    );
    const trimmed = reason.trim();
    if (!trimmed) {
      throw new InvalidInputError(
        'cancellation_reason_required',
        'Give a reason for cancelling',
      );
    }
    this.props.cancellationReason = trimmed;
    this.props.status = 'CANCELLED';
    this.record('CANCELLED', actor.id, trimmed, now);
  }

  /** Lifecycle changes since load, for the repository to persist. Clears the buffer. */
  pullChanges(): StatusChange[] {
    const changes = this.changes;
    this.changes = [];
    return changes;
  }

  toSnapshot(): Readonly<ServiceRequestProps> {
    return { ...this.props };
  }

  private assertStatus(
    allowed: readonly ServiceRequestStatus[],
    action: string,
  ): void {
    if (!allowed.includes(this.props.status)) {
      throw new ConflictError(
        'invalid_status_transition',
        `Cannot ${action} a request that is ${this.props.status.toLowerCase().replaceAll('_', ' ')}`,
      );
    }
  }

  private record(
    status: ServiceRequestStatus,
    actorId: string | null,
    note: string | null,
    at: Date,
  ) {
    this.changes.push({ status, actorId, note, at });
  }
}
