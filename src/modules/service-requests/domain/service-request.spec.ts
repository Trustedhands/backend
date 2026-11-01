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
  kind: 'VISIT',
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
  request.price(
    { workerFeeRwf: 20_000, serviceFeeRwf: 1_000, workerId: 'worker-1' },
    ADMIN,
    NOW,
  );
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
      [{ scheduledAt: new Date('2027-12-01T07:00:00Z') }, 'schedule_too_far'],
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

    request.price(
      { workerFeeRwf: 15_000, serviceFeeRwf: 1_000, workerId: 'worker-1' },
      ADMIN,
      NOW,
    );
    expect(request.status).toBe('PRICED');
    expect(request.totalRwf).toBe(16_000);
    expect(request.toSnapshot().adjustmentNote).toBeNull();
  });

  it('rejects zero or fractional prices', () => {
    const request = ServiceRequest.submit(submission(), NOW);
    expect(() =>
      request.price(
        { workerFeeRwf: 0, serviceFeeRwf: 0, workerId: 'worker-1' },
        ADMIN,
      ),
    ).toThrow(InvalidInputError);
    expect(() =>
      request.price(
        { workerFeeRwf: 10.5, serviceFeeRwf: 0, workerId: 'worker-1' },
        ADMIN,
      ),
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

  describe('worker hold and confirmation', () => {
    it('holds the worker when pricing and confirms them after payment', () => {
      const request = priced();
      expect(request.assignedWorkerId).toBe('worker-1');
      request.markPaid(21_000);
      request.assignWorker(null, ADMIN);
      expect(request.status).toBe('ASSIGNED');
      expect(request.assignedWorkerId).toBe('worker-1');
    });

    it('needs a held worker to price', () => {
      const request = ServiceRequest.submit(submission(), NOW);
      expect(() =>
        request.price(
          { workerFeeRwf: 20_000, serviceFeeRwf: 1_000, workerId: '' },
          ADMIN,
        ),
      ).toThrow(expect.objectContaining({ code: 'worker_required' }));
    });

    it('lets ops swap the worker when confirming', () => {
      const request = priced();
      request.markPaid(21_000);
      request.assignWorker('worker-2', ADMIN);
      expect(request.assignedWorkerId).toBe('worker-2');
    });
  });

  describe('payment reminders', () => {
    it('reminds a priced request at most hourly', () => {
      const request = priced();
      request.remind(NOW);
      expect(() =>
        request.remind(new Date(NOW.getTime() + 30 * 60_000)),
      ).toThrow(expect.objectContaining({ code: 'reminder_cooldown' }));
      expect(() =>
        request.remind(new Date(NOW.getTime() + 61 * 60_000)),
      ).not.toThrow();
    });

    it('only reminds about unpaid prices', () => {
      expect(() =>
        ServiceRequest.submit(submission(), NOW).remind(NOW),
      ).toThrow(expect.objectContaining({ code: 'invalid_status_transition' }));
    });
  });

  it('completes automatically, recorded as the system', () => {
    const request = priced();
    request.markPaid(21_000);
    request.assignWorker(null, ADMIN);
    request.pullChanges();
    request.autoComplete(NOW);
    expect(request.status).toBe('COMPLETED');
    expect(request.pullChanges()).toEqual([
      {
        status: 'COMPLETED',
        actorId: null,
        note: 'Completed automatically after the visit',
        at: NOW,
      },
    ]);
  });

  describe('placements', () => {
    const placement = (over: Partial<SubmitServiceRequest> = {}) =>
      submission({
        category: 'HOUSE_HELP',
        kind: 'PLACEMENT',
        durationHours: null,
        placement: {
          arrangement: 'LIVE_OUT',
          daysPerWeek: 6,
          salaryRwf: 80_000,
        },
        ...over,
      });

    it('takes a start date and terms instead of a duration', () => {
      const request = ServiceRequest.submit(placement(), NOW);
      expect(request.toSnapshot()).toMatchObject({
        kind: 'PLACEMENT',
        durationHours: null,
        placement: {
          arrangement: 'LIVE_OUT',
          daysPerWeek: 6,
          salaryRwf: 80_000,
        },
      });
    });

    it.each([
      [{ placement: null }, 'placement_required'],
      [
        {
          placement: {
            arrangement: 'LIVE_OUT' as const,
            daysPerWeek: 0,
            salaryRwf: null,
          },
        },
        'invalid_days',
      ],
      [
        {
          placement: {
            arrangement: 'LIVE_IN' as const,
            daysPerWeek: 5,
            salaryRwf: -1,
          },
        },
        'invalid_salary',
      ],
    ])('rejects %o', (over, code) => {
      expect(() => ServiceRequest.submit(placement(over), NOW)).toThrow(
        expect.objectContaining({ code }),
      );
    });

    it('ignores any duration on a placement, and needs one on a visit', () => {
      expect(
        ServiceRequest.submit(placement({ durationHours: 4 }), NOW).toSnapshot()
          .durationHours,
      ).toBeNull();
      expect(() =>
        ServiceRequest.submit(submission({ durationHours: null }), NOW),
      ).toThrow(expect.objectContaining({ code: 'invalid_duration' }));
    });
  });
});
