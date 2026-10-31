/** Pure ranking rules for "Suggested workers". */

export type MatchingCriterion =
  'AVAILABILITY' | 'LANGUAGE' | 'GENDER' | 'RATING' | 'DISTANCE';

export interface Candidate {
  id: string;
  available: boolean;
  languageMatch: boolean;
  genderMatch: boolean;
  ratingAverage: number | null;
  distanceKm: number | null;
}

/** Great-circle distance in km, rounded to 0.1. */
export function distanceKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(6371 * 2 * Math.asin(Math.sqrt(h)) * 10) / 10;
}

/** Do [start, start+hours) windows overlap, allowing a travel buffer between jobs? */
export function overlaps(
  a: { start: Date; hours: number },
  b: { start: Date; hours: number },
  bufferMinutes = 30,
): boolean {
  const buffer = bufferMinutes * 60_000;
  const aEnd = a.start.getTime() + a.hours * 3_600_000 + buffer;
  const bEnd = b.start.getTime() + b.hours * 3_600_000 + buffer;
  return a.start.getTime() < bEnd && b.start.getTime() < aEnd;
}

const comparators: Record<
  MatchingCriterion,
  (a: Candidate, b: Candidate) => number
> = {
  AVAILABILITY: (a, b) => Number(b.available) - Number(a.available),
  LANGUAGE: (a, b) => Number(b.languageMatch) - Number(a.languageMatch),
  GENDER: (a, b) => Number(b.genderMatch) - Number(a.genderMatch),
  // Unrated workers sort after rated ones
  RATING: (a, b) => (b.ratingAverage ?? -1) - (a.ratingAverage ?? -1),
  // Unknown distance sorts last
  DISTANCE: (a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity),
};

/** Sorts by each criterion in turn, as ordered in Settings. */
export function rankCandidates<T extends Candidate>(
  candidates: T[],
  priority: MatchingCriterion[],
): T[] {
  return [...candidates].sort((a, b) => {
    for (const criterion of priority) {
      const result = comparators[criterion](a, b);
      if (result !== 0 && !Number.isNaN(result)) return result;
    }
    return 0;
  });
}
