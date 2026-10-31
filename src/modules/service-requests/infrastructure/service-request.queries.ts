import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma/client.js';
import { NotFoundError } from '../../../shared/domain/domain-error.js';
import { PrismaService } from '../../../shared/database/prisma.service.js';
import {
  formatReceiptRef,
  formatRequestRef,
} from '../../../shared/http/references.js';
import { loadWorkerStats } from '../../workers/infrastructure/worker-stats.js';
import {
  ACTIVE_STATUSES,
  type ServiceRequestStatus,
} from '../domain/service-request.js';
import type {
  AdminServiceRequestDetailView,
  AdminServiceRequestSummaryView,
  AssignedWorkerView,
  ClientContactView,
  ServiceRequestDetailView,
  ServiceRequestSummaryView,
} from '../presentation/service-request.views.js';

const summaryInclude = {
  assignedWorker: {
    select: { id: true, fullName: true, languages: true, idVerified: true },
  },
} satisfies Prisma.ServiceRequestInclude;

const detailInclude = {
  ...summaryInclude,
  events: {
    orderBy: { createdAt: 'asc' },
    select: { status: true, note: true, createdAt: true },
  },
  payments: {
    where: { status: { in: ['SUCCESSFUL', 'PENDING'] } },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      receiptNumber: true,
      amountRwf: true,
      status: true,
      completedAt: true,
    },
  },
  review: { select: { id: true } },
} satisfies Prisma.ServiceRequestInclude;

const clientSelect = {
  id: true,
  fullName: true,
  user: { select: { email: true, phone: true } },
} satisfies Prisma.ProfileSelect;

type ClientRow = Prisma.ProfileGetPayload<{ select: typeof clientSelect }>;

function toContacts(clients: ClientRow[]): Map<string, ClientContactView> {
  return new Map(
    clients.map((c) => [
      c.id,
      {
        id: c.id,
        fullName: c.fullName,
        email: c.user.email,
        phone: c.user.phone,
      },
    ]),
  );
}

type SummaryRow = Prisma.ServiceRequestGetPayload<{
  include: typeof summaryInclude;
}>;
type DetailRow = Prisma.ServiceRequestGetPayload<{
  include: typeof detailInclude;
}>;

/** Read side for service requests: shapes rows into the views the apps render. */
@Injectable()
export class ServiceRequestQueries {
  constructor(private readonly prisma: PrismaService) {}

  async listForClient(
    clientId: string,
    scope: 'active' | 'past',
  ): Promise<ServiceRequestSummaryView[]> {
    const rows = await this.prisma.serviceRequest.findMany({
      where: {
        clientId,
        status:
          scope === 'active'
            ? { in: [...ACTIVE_STATUSES] }
            : { notIn: [...ACTIVE_STATUSES] },
      },
      orderBy:
        scope === 'active' ? { scheduledAt: 'asc' } : { scheduledAt: 'desc' },
      include: summaryInclude,
      take: 100,
    });
    return this.toSummaries(rows);
  }

  async getForClient(
    clientId: string,
    id: string,
  ): Promise<ServiceRequestDetailView> {
    const row = await this.prisma.serviceRequest.findFirst({
      where: { id, clientId },
      include: detailInclude,
    });
    if (!row)
      throw new NotFoundError('service_request_not_found', 'Request not found');
    return this.toDetail(row);
  }

  async listForAdmin(filter: {
    status?: ServiceRequestStatus;
    skip: number;
    take: number;
  }): Promise<{ items: AdminServiceRequestSummaryView[]; total: number }> {
    const where: Prisma.ServiceRequestWhereInput = filter.status
      ? { status: filter.status }
      : {};
    const [rows, total] = await Promise.all([
      this.prisma.serviceRequest.findMany({
        where,
        // Oldest first: the ops queue works through requests in order received
        orderBy: { createdAt: 'asc' },
        include: {
          ...summaryInclude,
          client: { select: clientSelect },
        },
        skip: filter.skip,
        take: filter.take,
      }),
      this.prisma.serviceRequest.count({ where }),
    ]);
    const [summaries, contacts] = await Promise.all([
      this.toSummaries(rows),
      toContacts(rows.map((r) => r.client)),
    ]);
    return {
      items: summaries.map((s, i) => ({
        ...s,
        client: contacts.get(rows[i].clientId)!,
      })),
      total,
    };
  }

  async getForAdmin(id: string): Promise<AdminServiceRequestDetailView> {
    const row = await this.prisma.serviceRequest.findUnique({
      where: { id },
      include: {
        ...detailInclude,
        client: { select: clientSelect },
      },
    });
    if (!row)
      throw new NotFoundError('service_request_not_found', 'Request not found');
    const [detail, contacts] = await Promise.all([
      this.toDetail(row),
      toContacts([row.client]),
    ]);
    return {
      ...detail,
      client: contacts.get(row.clientId)!,
      version: row.version,
    };
  }

  private async toSummaries(
    rows: SummaryRow[],
  ): Promise<ServiceRequestSummaryView[]> {
    const stats = await loadWorkerStats(
      this.prisma,
      rows.flatMap((r) => (r.assignedWorkerId ? [r.assignedWorkerId] : [])),
    );
    return rows.map((row) => {
      const worker: AssignedWorkerView | null = row.assignedWorker
        ? { ...row.assignedWorker, ...stats.get(row.assignedWorker.id)! }
        : null;
      return {
        id: row.id,
        reference: formatRequestRef(row.number),
        category: row.category,
        description: row.description,
        scheduledAt: row.scheduledAt,
        durationHours: row.durationHours.toNumber(),
        status: row.status,
        totalRwf: totalOf(row),
        worker,
        createdAt: row.createdAt,
      };
    });
  }

  private async toDetail(row: DetailRow): Promise<ServiceRequestDetailView> {
    const [summary] = await this.toSummaries([row]);
    const paid = row.payments.find((p) => p.status === 'SUCCESSFUL');
    const total = totalOf(row);
    return {
      ...summary,
      preferredGender: row.preferredGender,
      preferredLanguages: row.preferredLanguages,
      address: {
        district: row.addressDistrict,
        sector: row.addressSector,
        street: row.addressStreet,
        latitude: row.addressLatitude,
        longitude: row.addressLongitude,
      },
      quote:
        total !== null && row.pricedAt
          ? {
              workerFeeRwf: row.workerFeeRwf!,
              serviceFeeRwf: row.serviceFeeRwf!,
              discountRwf: row.discountRwf,
              totalRwf: total,
              note: row.quoteNote,
              pricedAt: row.pricedAt,
            }
          : null,
      adjustmentNote: row.adjustmentNote,
      cancellationReason: row.cancellationReason,
      completedAt: row.completedAt,
      timeline: row.events.map((e) => ({
        status: e.status,
        note: e.note,
        at: e.createdAt,
      })),
      payment: paid
        ? {
            id: paid.id,
            receiptReference: formatReceiptRef(paid.receiptNumber),
            amountRwf: paid.amountRwf,
            completedAt: paid.completedAt,
          }
        : null,
      hasPendingPayment: row.payments.some((p) => p.status === 'PENDING'),
      hasReview: row.review !== null,
    };
  }
}

function totalOf(row: {
  workerFeeRwf: number | null;
  serviceFeeRwf: number | null;
  discountRwf: number;
}) {
  if (row.workerFeeRwf === null || row.serviceFeeRwf === null) return null;
  return Math.max(0, row.workerFeeRwf + row.serviceFeeRwf - row.discountRwf);
}
