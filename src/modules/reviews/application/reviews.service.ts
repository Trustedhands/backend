import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../../config/env.js';
import { Prisma } from '../../../generated/prisma/client.js';
import {
  ConflictError,
  NotFoundError,
} from '../../../shared/domain/domain-error.js';
import { PrismaService } from '../../../shared/database/prisma.service.js';
import { formatRequestRef } from '../../../shared/http/references.js';
import { Mailer } from '../../auth/application/ports.js';
import { ServiceRequestRepository } from '../../service-requests/domain/service-request.repository.js';
import { draftReview, LOW_RATING, type ReviewTag } from '../domain/review.js';
import type {
  AdminReviewPage,
  ReviewView,
} from '../presentation/review.dto.js';

@Injectable()
export class ReviewsService {
  private readonly logger = new Logger(ReviewsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly requests: ServiceRequestRepository,
    private readonly mailer: Mailer,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async submit(
    clientId: string,
    serviceRequestId: string,
    input: { rating: number; tags: ReviewTag[]; comment?: string },
  ): Promise<ReviewView> {
    const request = await this.requests.findById(serviceRequestId);
    if (!request || !request.isOwnedBy(clientId)) {
      throw new NotFoundError('service_request_not_found', 'Request not found');
    }
    const draft = draftReview(request, clientId, input);
    try {
      const review = await this.prisma.review.create({ data: draft });
      if (review.rating <= LOW_RATING) await this.flagLowRating(review.id);
      return {
        id: review.id,
        rating: review.rating,
        tags: review.tags,
        comment: review.comment,
        createdAt: review.createdAt,
      };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictError(
          'already_reviewed',
          'You have already reviewed this job',
        );
      }
      throw error;
    }
  }

  async listForAdmin(filter: {
    workerId?: string;
    maxRating?: number;
    skip: number;
    take: number;
  }): Promise<Omit<AdminReviewPage, never>> {
    const where: Prisma.ReviewWhereInput = {
      ...(filter.workerId ? { workerId: filter.workerId } : {}),
      ...(filter.maxRating ? { rating: { lte: filter.maxRating } } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.review.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: filter.skip,
        take: filter.take,
        include: {
          worker: { select: { fullName: true } },
          client: { select: { fullName: true } },
          serviceRequest: { select: { number: true } },
        },
      }),
      this.prisma.review.count({ where }),
    ]);
    return {
      total,
      items: rows.map((r) => ({
        id: r.id,
        rating: r.rating,
        tags: r.tags,
        comment: r.comment,
        createdAt: r.createdAt,
        serviceRequestId: r.serviceRequestId,
        serviceRequestReference: formatRequestRef(r.serviceRequest.number),
        workerId: r.workerId,
        workerName: r.worker.fullName,
        clientName: r.client.fullName,
      })),
    };
  }

  /** Emails the support inbox so ops can follow up on a poor job. Never fails the review. */
  private async flagLowRating(reviewId: string): Promise<void> {
    const inbox = this.config.get('SUPPORT_INBOX', { infer: true });
    if (!inbox) return;
    try {
      const r = await this.prisma.review.findUniqueOrThrow({
        where: { id: reviewId },
        include: {
          worker: { select: { fullName: true } },
          client: { select: { fullName: true } },
          serviceRequest: { select: { number: true } },
        },
      });
      const ref = formatRequestRef(r.serviceRequest.number);
      const text = [
        `${r.client.fullName} rated ${r.worker.fullName} ${r.rating}/5 on ${ref}.`,
        r.tags.length ? `Tags: ${r.tags.join(', ')}` : null,
        r.comment ? `Comment: ${r.comment}` : null,
      ]
        .filter(Boolean)
        .join('\n');
      await this.mailer.send({
        to: inbox,
        subject: `Low rating (${r.rating}/5) on ${ref}`,
        text,
        html: `<pre style="font-family:Arial,sans-serif;white-space:pre-wrap">${escapeHtml(text)}</pre>`,
      });
    } catch (error) {
      this.logger.error(`Low-rating alert failed: ${(error as Error).message}`);
    }
  }
}

const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]!,
  );
