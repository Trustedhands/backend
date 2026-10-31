import { Injectable } from '@nestjs/common';
import type { Worker } from '../../../generated/prisma/client.js';
import {
  ConflictError,
  NotFoundError,
} from '../../../shared/domain/domain-error.js';
import { PrismaService } from '../../../shared/database/prisma.service.js';
import { loadWorkerStats } from '../infrastructure/worker-stats.js';
import type {
  CreateWorkerDto,
  ListWorkersQuery,
  UpdateWorkerDto,
  WorkerView,
} from '../presentation/worker.dto.js';

@Injectable()
export class WorkersService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: ListWorkersQuery): Promise<WorkerView[]> {
    const workers = await this.prisma.worker.findMany({
      where: {
        ...(query.includeInactive ? {} : { active: true }),
        ...(query.category ? { categories: { has: query.category } } : {}),
      },
      orderBy: { fullName: 'asc' },
    });
    return this.toViews(workers);
  }

  async get(id: string): Promise<WorkerView> {
    const [view] = await this.toViews([await this.find(id)]);
    return view;
  }

  async create(dto: CreateWorkerDto): Promise<WorkerView> {
    const worker = await this.prisma.worker.create({ data: dto });
    return this.get(worker.id);
  }

  async update(id: string, dto: UpdateWorkerDto): Promise<WorkerView> {
    await this.find(id);
    await this.prisma.worker.update({ where: { id }, data: dto });
    return this.get(id);
  }

  /** Used by the service-requests context before assigning. */
  async assertAssignable(id: string): Promise<void> {
    const worker = await this.find(id);
    if (!worker.active) {
      throw new ConflictError(
        'worker_inactive',
        `${worker.fullName} is deactivated`,
      );
    }
  }

  private async find(id: string): Promise<Worker> {
    const worker = await this.prisma.worker.findUnique({ where: { id } });
    if (!worker)
      throw new NotFoundError('worker_not_found', 'Worker not found');
    return worker;
  }

  private async toViews(workers: Worker[]): Promise<WorkerView[]> {
    const stats = await loadWorkerStats(
      this.prisma,
      workers.map((w) => w.id),
    );
    return workers.map((w) => ({
      id: w.id,
      fullName: w.fullName,
      phone: w.phone,
      gender: w.gender,
      languages: w.languages,
      categories: w.categories,
      idVerified: w.idVerified,
      active: w.active,
      notes: w.notes,
      createdAt: w.createdAt,
      ...stats.get(w.id)!,
    }));
  }
}
