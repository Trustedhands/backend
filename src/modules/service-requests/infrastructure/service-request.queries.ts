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
  PipelineColumnView,
  PipelineView,
  ServiceRequestDetailView,
  ServiceRequestSummaryView,
} from '../presentation/service-request.views.js';

/** Clients only see their worker once ops has confirmed them after payment. */
const WORKER_VISIBLE_TO_CLIENT: readonly ServiceRequestStatus[] = [
  'ASSIGNED',
  'IN_PROGRESS',
  'COMPLETED',
];

const summaryInclude = {
  assignedWorker: {
    select: { id: true, fullName: true, languages: true, status: true },
  },
  serviceType: { select: { label: true } },
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
  review: {
    select: {
      id: true,
      rating: true,
      tags: true,
      comment: true,
      createdAt: true,
    },
  },
} satisfies Prisma.ServiceRequestInclude;

const clientSelect = {
  id: true,
  fullName: true,
  accountType: true,
  companyName: true,
  kycStatus: true,
  user: { select: { email: true, phone: true } },
} satisfies Prisma.ProfileSelect;

type ClientRow = Prisma.ProfileGetPayload<{ select: typeof clientSelect }>;
type SummaryRow = Prisma.ServiceRequestGetPayload<{
  include: typeof summaryInclude;
}>;
type DetailRow = Prisma.ServiceRequestGetPayload<{
  include: typeof detailInclude;
}>;
type AdminSummaryRow = SummaryRow & { client: ClientRow };
type Audience = 'client' | 'admin';

const PIPELINE: ReadonlyArray<{
  key: PipelineColumnView['key'];
  statuses: ServiceRequestStatus[];
}> = [
  { key: 'NEW', statuses: ['REQUESTED', 'ADJUSTMENT_REQUESTED'] },
  { key: 'PRICED', statuses: ['PRICED'] },
  { key: 'PAID', statuses: ['PAID'] },
  { key: 'SCHEDULED', statuses: ['ASSIGNED'] },
  { key: 'IN_PROGRESS', statuses: ['IN_PROGRESS'] },
];

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
    return this.toSummaries(rows, 'client');
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
    return this.toDetail(row, 'client');
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
        include: { ...summaryInclude, client: { select: clientSelect } },
        skip: filter.skip,
        take: filter.take,
      }),
      this.prisma.serviceRequest.count({ where }),
    ]);
    return { items: await this.toAdminSummaries(rows), total };
  }

  /** "Requests": one column per stage, soonest first. */
  async pipeline(
    filter: { category?: string; days?: number },
    now = new Date(),
  ): Promise<PipelineView> {
    const window = filter.days
      ? {
          scheduledAt: {
            gte: new Date(now.getTime() - filter.days * 864e5),
            lte: new Date(now.getTime() + filter.days * 864e5),
          },
        }
      : {};
    const base: Prisma.ServiceRequestWhereInput = {
      ...(filter.category ? { category: filter.category } : {}),
      ...window,
    };
    const columns = await Promise.all(
      PIPELINE.map(async (column) => {
        const where = { ...base, status: { in: column.statuses } };
        const [rows, count] = await Promise.all([
          this.prisma.serviceRequest.findMany({
            where,
            orderBy: { scheduledAt: 'asc' },
            include: { ...summaryInclude, client: { select: clientSelect } },
            take: 50,
          }),
          this.prisma.serviceRequest.count({ where }),
        ]);
        return {
          key: column.key,
          count,
          cards: await this.toAdminSummaries(rows),
        };
      }),
    );
    return { columns };
  }

  /** Dashboard "Requests needing action": new, paid (confirm worker), priced (remind). */
  async needingAction(take = 8): Promise<AdminServiceRequestSummaryView[]> {
    const rows = await this.prisma.serviceRequest.findMany({
      where: {
        status: { in: ['REQUESTED', 'ADJUSTMENT_REQUESTED', 'PAID', 'PRICED'] },
      },
      orderBy: { scheduledAt: 'asc' },
      include: { ...summaryInclude, client: { select: clientSelect } },
      take,
    });
    return this.toAdminSummaries(rows);
  }

  async listByIds(ids: string[]): Promise<AdminServiceRequestSummaryView[]> {
    const rows = await this.prisma.serviceRequest.findMany({
      where: { id: { in: ids } },
      orderBy: { scheduledAt: 'desc' },
      include: { ...summaryInclude, client: { select: clientSelect } },
    });
    return this.toAdminSummaries(rows);
  }

  async getForAdmin(id: string): Promise<AdminServiceRequestDetailView> {
    const row = await this.prisma.serviceRequest.findUnique({
      where: { id },
      include: { ...detailInclude, client: { select: clientSelect } },
    });
    if (!row)
      throw new NotFoundError('service_request_not_found', 'Request not found');
    const detail = await this.toDetail(row, 'admin');
    return {
      ...detail,
      client: toContact(row.client),
      remindedAt: row.remindedAt,
      version: row.version,
    };
  }

  private async toAdminSummaries(
    rows: AdminSummaryRow[],
  ): Promise<AdminServiceRequestSummaryView[]> {
    const summaries = await this.toSummaries(rows, 'admin');
    return summaries.map((s, i) => ({
      ...s,
      client: toContact(rows[i]!.client),
      remindedAt: rows[i]!.remindedAt,
    }));
  }

  private async toSummaries(
    rows: SummaryRow[],
    audience: Audience,
  ): Promise<ServiceRequestSummaryView[]> {
    const visible = (row: SummaryRow) =>
      row.assignedWorker &&
      (audience === 'admin' || WORKER_VISIBLE_TO_CLIENT.includes(row.status))
        ? row.assignedWorker
        : null;
    const stats = await loadWorkerStats(
      this.prisma,
      rows.flatMap((r) => (visible(r) ? [visible(r)!.id] : [])),
    );
    return rows.map((row) => {
      const w = visible(row);
      const worker: AssignedWorkerView | null = w
        ? {
            id: w.id,
            fullName: w.fullName,
            languages: w.languages,
            idVerified: w.status === 'VERIFIED',
            ...stats.get(w.id)!,
          }
        : null;
      return {
        id: row.id,
        reference: formatRequestRef(row.number),
        category: row.category,
        categoryLabel: row.serviceType.label,
        kind: row.kind,
        description: row.description,
        scheduledAt: row.scheduledAt,
        durationHours: row.durationHours?.toNumber() ?? null,
        placement:
          row.kind === 'PLACEMENT' &&
          row.placementArrangement &&
          row.placementDaysPerWeek
            ? {
                arrangement: row.placementArrangement,
                daysPerWeek: row.placementDaysPerWeek,
                salaryRwf: row.placementSalaryRwf,
              }
            : null,
        status: row.status,
        totalRwf: totalOf(row),
        worker,
        createdAt: row.createdAt,
      };
    });
  }

  private async toDetail(
    row: DetailRow,
    audience: Audience,
  ): Promise<ServiceRequestDetailView> {
    const [summary] = await this.toSummaries([row], audience);
    const paid = row.payments.find((p) => p.status === 'SUCCESSFUL');
    const total = totalOf(row);
    return {
      ...summary!,
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
      review: row.review,
    };
  }
}

function toContact(c: ClientRow): ClientContactView {
  return {
    id: c.id,
    fullName: c.fullName,
    email: c.user.email,
    phone: c.user.phone,
    accountType: c.accountType,
    companyName: c.companyName,
    kycStatus: c.kycStatus,
  };
}

function totalOf(row: {
  workerFeeRwf: number | null;
  serviceFeeRwf: number | null;
  discountRwf: number;
}) {
  if (row.workerFeeRwf === null || row.serviceFeeRwf === null) return null;
  return Math.max(0, row.workerFeeRwf + row.serviceFeeRwf - row.discountRwf);
}
