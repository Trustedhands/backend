import type { Db } from '../../../shared/database/prisma.service.js';

export interface WorkerStats {
  ratingAverage: number | null;
  completedJobs: number;
}

/** Rating average and completed-job count per worker, e.g. "4.8 · 56 jobs". */
export async function loadWorkerStats(
  db: Db,
  workerIds: string[],
): Promise<Map<string, WorkerStats>> {
  const ids = [...new Set(workerIds)];
  const stats = new Map<string, WorkerStats>(
    ids.map((id) => [id, { ratingAverage: null, completedJobs: 0 }]),
  );
  if (!ids.length) return stats;

  const [ratings, jobs] = await Promise.all([
    db.review.groupBy({
      by: ['workerId'],
      where: { workerId: { in: ids } },
      _avg: { rating: true },
    }),
    db.serviceRequest.groupBy({
      by: ['assignedWorkerId'],
      where: { assignedWorkerId: { in: ids }, status: 'COMPLETED' },
      _count: { _all: true },
    }),
  ]);
  for (const r of ratings) {
    const avg = r._avg.rating;
    stats.get(r.workerId)!.ratingAverage =
      avg === null ? null : Math.round(avg * 10) / 10;
  }
  for (const j of jobs) {
    if (j.assignedWorkerId)
      stats.get(j.assignedWorkerId)!.completedJobs = j._count._all;
  }
  return stats;
}
