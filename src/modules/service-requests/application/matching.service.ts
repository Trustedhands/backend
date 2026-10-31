import { Injectable } from '@nestjs/common';
import { NotFoundError } from '../../../shared/domain/domain-error.js';
import { PrismaService } from '../../../shared/database/prisma.service.js';
import { formatRequestRef } from '../../../shared/http/references.js';
import { ConfigurationService } from '../../configuration/application/configuration.service.js';
import { loadWorkerStats } from '../../workers/infrastructure/worker-stats.js';
import {
  distanceKm,
  type MatchingCriterion,
  overlaps,
  rankCandidates,
} from '../domain/matching.js';
import type { SuggestedWorkerView } from '../presentation/service-request.views.js';

/** Statuses in which a worker is committed to a request (held or confirmed). */
const COMMITTED = ['PRICED', 'PAID', 'ASSIGNED', 'IN_PROGRESS'] as const;

@Injectable()
export class MatchingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigurationService,
  ) {}

  async suggest(
    requestId: string,
    sort: 'best' | 'rating' | 'distance',
  ): Promise<SuggestedWorkerView[]> {
    const request = await this.prisma.serviceRequest.findUnique({
      where: { id: requestId },
    });
    if (!request)
      throw new NotFoundError('service_request_not_found', 'Request not found');

    const workers = await this.prisma.worker.findMany({
      where: {
        status: 'VERIFIED',
        active: true,
        categories: { has: request.category },
      },
      take: 200,
    });
    const ids = workers.map((w) => w.id);
    const window = {
      start: request.scheduledAt,
      hours: request.durationHours.toNumber(),
    };

    // Other bookings around the same day that could clash
    const dayMs = 864e5;
    const [stats, bookings, settings] = await Promise.all([
      loadWorkerStats(this.prisma, ids),
      this.prisma.serviceRequest.findMany({
        where: {
          assignedWorkerId: { in: ids },
          id: { not: request.id },
          status: { in: [...COMMITTED] },
          scheduledAt: {
            gte: new Date(request.scheduledAt.getTime() - dayMs),
            lte: new Date(request.scheduledAt.getTime() + dayMs),
          },
        },
        select: {
          assignedWorkerId: true,
          number: true,
          scheduledAt: true,
          durationHours: true,
        },
      }),
      this.config.settings(),
    ]);

    const site =
      request.addressLatitude !== null && request.addressLongitude !== null
        ? { lat: request.addressLatitude, lng: request.addressLongitude }
        : null;

    const candidates = workers.map((w) => {
      const clash = bookings.find(
        (b) =>
          b.assignedWorkerId === w.id &&
          overlaps(window, {
            start: b.scheduledAt,
            hours: b.durationHours.toNumber(),
          }),
      );
      const { ratingAverage, completedJobs } = stats.get(w.id)!;
      return {
        id: w.id,
        fullName: w.fullName,
        ratingAverage,
        completedJobs,
        languages: w.languages,
        categories: w.categories,
        district: w.district,
        sector: w.sector,
        distanceKm:
          site && w.latitude !== null && w.longitude !== null
            ? distanceKm(site, { lat: w.latitude, lng: w.longitude })
            : null,
        available: !clash,
        conflict: clash
          ? {
              reference: formatRequestRef(clash.number),
              scheduledAt: clash.scheduledAt,
            }
          : null,
        languageMatch:
          request.preferredLanguages.length === 0 ||
          w.languages.some((l) => request.preferredLanguages.includes(l)),
        genderMatch:
          request.preferredGender === 'ANY' ||
          request.preferredGender === w.gender,
        isAssigned: request.assignedWorkerId === w.id,
      };
    });

    const priority: MatchingCriterion[] =
      sort === 'rating'
        ? ['RATING', 'AVAILABILITY']
        : sort === 'distance'
          ? ['DISTANCE', 'AVAILABILITY']
          : (settings.matchingPriority as MatchingCriterion[]);
    return rankCandidates(candidates, priority);
  }
}
