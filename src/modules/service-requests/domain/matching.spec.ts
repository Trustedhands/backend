import {
  distanceKm,
  overlaps,
  rankCandidates,
  type Candidate,
} from './matching.js';

const c = (id: string, over: Partial<Candidate> = {}): Candidate => ({
  id,
  available: true,
  languageMatch: true,
  genderMatch: true,
  ratingAverage: 4.5,
  distanceKm: 2,
  ...over,
});

describe('matching', () => {
  it('measures distance between Kigali neighbourhoods', () => {
    // Kimihurura → Kacyiru, roughly 2 km
    const d = distanceKm(
      { lat: -1.9536, lng: 30.0935 },
      { lat: -1.9441, lng: 30.0769 },
    );
    expect(d).toBeGreaterThan(1.5);
    expect(d).toBeLessThan(2.5);
  });

  it('detects clashes including a travel buffer', () => {
    const nine = new Date('2026-11-03T07:00:00Z');
    expect(
      overlaps(
        { start: nine, hours: 4 },
        { start: new Date('2026-11-03T11:15:00Z'), hours: 2 },
      ),
    ).toBe(true);
    expect(
      overlaps(
        { start: nine, hours: 4 },
        { start: new Date('2026-11-03T11:45:00Z'), hours: 2 },
      ),
    ).toBe(false);
  });

  it('ranks by the configured priority', () => {
    const busyTopRated = c('busy', { available: false, ratingAverage: 5 });
    const freeLower = c('free', { ratingAverage: 4.1 });
    const freeHigher = c('freeHigher', { ratingAverage: 4.9 });
    const order = rankCandidates(
      [busyTopRated, freeLower, freeHigher],
      ['AVAILABILITY', 'RATING'],
    );
    expect(order.map((x) => x.id)).toEqual(['freeHigher', 'free', 'busy']);

    const byRatingOnly = rankCandidates(
      [busyTopRated, freeLower, freeHigher],
      ['RATING'],
    );
    expect(byRatingOnly[0]!.id).toBe('busy');
  });

  it('puts unknown distance and unrated workers last', () => {
    const order = rankCandidates(
      [c('far', { distanceKm: null }), c('near', { distanceKm: 0.8 })],
      ['DISTANCE'],
    );
    expect(order.map((x) => x.id)).toEqual(['near', 'far']);
    const rated = rankCandidates(
      [c('new', { ratingAverage: null }), c('old', { ratingAverage: 3 })],
      ['RATING'],
    );
    expect(rated[0]!.id).toBe('old');
  });
});
