import {
  ConflictError,
  InvalidInputError,
} from '../../../shared/domain/domain-error.js';
import {
  ServiceRequest,
  type SubmitServiceRequest,
} from './service-request.js';

const NOW = new Date('2026-10-30T08:00:00Z');
const CLIENT = 'client-1';
const ADMIN = 'admin-1';

const submission = (
  overrides: Partial<SubmitServiceRequest> = {},
): SubmitServiceRequest => ({
  clientId: CLIENT,
  category: 'CLEANING',
  description: '3-bedroom house, full clean',
  scheduledAt: new Date('2026-11-01T07:00:00Z'),
  durationHours: 4,
  preferredGender: 'ANY',
  preferredLanguages: ['EN', 'FR', 'EN'],
  address: {
    district: 'Gasabo',
    sector: 'Kacyiru',
    street: 'KG 9 Ave, house 14',
    latitude: null,
    longitude: null,
  },
  ...overrides,
});

const priced = () => {
  const request = ServiceRequest.submit(submission(), NOW);
  request.price({ workerFeeRwf: 20_000, serviceFeeRwf: 1_000 }, ADMIN, NOW);
  return request;
};

describe('ServiceRequest', () => {
  describe('submit', () => {
    it('starts as REQUESTED and records the submission', () => {
      const request = ServiceRequest.submit(submission(), NOW);
      expect(request.status).toBe('REQUESTED');
      expect(request.totalRwf).toBeNull();
      expect(request.toSnapshot().preferredLanguages).toEqual(['EN', 'FR']);
      expect(request.pullChanges()).toEqual([
        { status: 'REQUESTED', actorId: CLIENT, note: null, at: NOW },
      ]);
      expect(request.pullChanges()).toEqual([]);
    });

    it.each([
      [{ description: '   ' }, 'description_required'],
      [{ durationHours: 0 }, 'invalid_duration'],
      [{ durationHours: 2.25 }, 'invalid_duration'],
      [{ durationHours: 13 }, 'invalid_duration'],
      [{ scheduledAt: new Date('2026-10-30T07:00:00Z') }, 'schedule_in_past'],
    ])('rejects %o', (override, code) => {
      expect(() => ServiceRequest.submit(submission(override), NOW)).toThrow(
        expect.objectContaining({ code }),
      );
    });
  });

  it('runs the happy path to completion', () => {
    const request = priced();
    expect(request.status).toBe('PRICED');
    expect(request.totalRwf).toBe(21_000);

    request.markPaid(21_000, NOW);
    request.assignWorker('worker-1', ADMIN, NOW);
    request.start(ADMIN, NOW);
    request.complete(CLIENT, NOW);

    expect(request.status).toBe('COMPLETED');
    expect(request.toSnapshot().completedAt).toEqual(NOW);
    expect(request.pullChanges().map((c) => c.status)).toEqual([
      'REQUESTED',
      'PRICED',
      'PAID',
      'ASSIGNED',
      'IN_PROGRESS',
      'COMPLETED',
    ]);
  });

  it('lets the client ask for an adjustment and ops re-price', () => {
    const request = priced();
    request.requestAdjustment('Only 3 hours needed', CLIENT, NOW);
    expect(request.status).toBe('ADJUSTMENT_REQUESTED');

    request.price({ workerFeeRwf: 15_000, serviceFeeRwf: 1_000 }, ADMIN, NOW);
    expect(request.status).toBe('PRICED');
    expect(request.totalRwf).toBe(16_000);
    expect(request.toSnapshot().adjustmentNote).toBeNull();
  });

  it('rejects zero or fractional prices', () => {
    const request = ServiceRequest.submit(submission(), NOW);
    expect(() =>
      request.price({ workerFeeRwf: 0, serviceFeeRwf: 0 }, ADMIN),
    ).toThrow(InvalidInputError);
    expect(() =>
      request.price({ workerFeeRwf: 10.5, serviceFeeRwf: 0 }, ADMIN),
    ).toThrow(InvalidInputError);
  });

  it('refuses payment for an amount other than the current price', () => {
    const request = priced();
    expect(() => request.markPaid(20_000)).toThrow(
      expect.objectContaining({ code: 'payment_amount_mismatch' }),
    );
    expect(request.status).toBe('PRICED');
  });

  it('refuses to assign a worker before payment', () => {
    expect(() => priced().assignWorker('worker-1', ADMIN)).toThrow(
      ConflictError,
    );
  });

  it('records a reassignment but ignores assigning the same worker twice', () => {
    const request = priced();
    request.markPaid(21_000);
    request.assignWorker('worker-1', ADMIN);
    request.assignWorker('worker-1', ADMIN);
    request.assignWorker('worker-2', ADMIN);
    const assigned = request
      .pullChanges()
      .filter((c) => c.status === 'ASSIGNED');
    expect(assigned.map((c) => c.note)).toEqual([null, 'Worker reassigned']);
    expect(request.assignedWorkerId).toBe('worker-2');
  });

  describe('cancel', () => {
    it('lets clients cancel before payment', () => {
      const request = priced();
      request.cancel('Plans changed', { id: CLIENT, isAdmin: false });
      expect(request.status).toBe('CANCELLED');
    });

    it('stops clients cancelling after payment, but not ops', () => {
      const request = priced();
      request.markPaid(21_000);
      expect(() =>
        request.cancel('Plans changed', { id: CLIENT, isAdmin: false }),
      ).toThrow(ConflictError);
      request.cancel('Worker unavailable', { id: ADMIN, isAdmin: true });
      expect(request.status).toBe('CANCELLED');
    });

    it('requires a reason', () => {
      expect(() =>
        priced().cancel(' ', { id: CLIENT, isAdmin: false }),
      ).toThrow(InvalidInputError);
    });
  });
});
