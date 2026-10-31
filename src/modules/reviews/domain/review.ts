import {
  ConflictError,
  InvalidInputError,
} from '../../../shared/domain/domain-error.js';
import type { ServiceRequest } from '../../service-requests/domain/service-request.js';

export const REVIEW_TAGS = [
  'ON_TIME',
  'THOROUGH',
  'FRIENDLY',
  'RESPECTFUL',
  'COMMUNICATED_WELL',
] as const;
export type ReviewTag = (typeof REVIEW_TAGS)[number];

const MAX_COMMENT_LENGTH = 1000;
/** Ratings at or below this are flagged to ops */
export const LOW_RATING = 2;

export interface ReviewDraft {
  serviceRequestId: string;
  clientId: string;
  workerId: string;
  rating: number;
  tags: ReviewTag[];
  comment: string | null;
}

/** A client rates the worker on one of their completed requests. */
export function draftReview(
  request: ServiceRequest,
  clientId: string,
  input: { rating: number; tags: ReviewTag[]; comment?: string | null },
): ReviewDraft {
  if (!request.isOwnedBy(clientId)) {
    throw new ConflictError(
      'not_reviewable',
      'You can only review your own requests',
    );
  }
  if (request.status !== 'COMPLETED' || !request.assignedWorkerId) {
    throw new ConflictError(
      'not_reviewable',
      'You can review a job once it is completed',
    );
  }
  if (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5) {
    throw new InvalidInputError(
      'invalid_rating',
      'Choose between 1 and 5 stars',
    );
  }
  const comment = input.comment?.trim() || null;
  if (comment && comment.length > MAX_COMMENT_LENGTH) {
    throw new InvalidInputError(
      'comment_too_long',
      `Keep it under ${MAX_COMMENT_LENGTH} characters`,
    );
  }
  return {
    serviceRequestId: request.id,
    clientId,
    workerId: request.assignedWorkerId,
    rating: input.rating,
    tags: [...new Set(input.tags)],
    comment,
  };
}
