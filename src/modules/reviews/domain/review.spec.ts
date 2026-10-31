import { ServiceRequest } from '../../service-requests/domain/service-request.js';
import { draftReview } from './review.js';

const NOW = new Date('2026-10-30T08:00:00Z');

function completedRequest() {
  const r = ServiceRequest.submit(
    {
      clientId: 'client-1',
      category: 'CLEANING',
      kind: 'VISIT',
      description: 'Full clean',
      scheduledAt: new Date('2026-11-01T07:00:00Z'),
      durationHours: 4,
      preferredGender: 'ANY',
      preferredLanguages: [],
      address: {
        district: 'Gasabo',
        sector: 'Kacyiru',
        street: 'KG 9 Ave',
        latitude: null,
        longitude: null,
      },
    },
    NOW,
  );
  r.price(
    { workerFeeRwf: 20_000, serviceFeeRwf: 1_000, workerId: 'worker-1' },
    'admin',
    NOW,
  );
  r.markPaid(21_000, NOW);
  r.assignWorker(null, 'admin', NOW);
  return r;
}

describe('draftReview', () => {
  it('drafts a review of the assigned worker, de-duplicating tags', () => {
    const r = completedRequest();
    r.complete('client-1', NOW);
    expect(
      draftReview(r, 'client-1', {
        rating: 5,
        tags: ['ON_TIME', 'ON_TIME', 'THOROUGH'],
        comment: '  Great  ',
      }),
    ).toEqual({
      serviceRequestId: r.id,
      clientId: 'client-1',
      workerId: 'worker-1',
      rating: 5,
      tags: ['ON_TIME', 'THOROUGH'],
      comment: 'Great',
    });
  });

  it('refuses before completion', () => {
    expect(() =>
      draftReview(completedRequest(), 'client-1', { rating: 4, tags: [] }),
    ).toThrow(expect.objectContaining({ code: 'not_reviewable' }));
  });

  it("refuses someone else's request", () => {
    const r = completedRequest();
    r.complete('client-1', NOW);
    expect(() => draftReview(r, 'client-2', { rating: 4, tags: [] })).toThrow(
      expect.objectContaining({ code: 'not_reviewable' }),
    );
  });

  it.each([0, 6, 3.5])('rejects rating %s', (rating) => {
    const r = completedRequest();
    r.complete('client-1', NOW);
    expect(() => draftReview(r, 'client-1', { rating, tags: [] })).toThrow(
      expect.objectContaining({ code: 'invalid_rating' }),
    );
  });
});
