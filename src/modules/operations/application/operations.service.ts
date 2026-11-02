import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma/client.js';
import { NotFoundError } from '../../../shared/domain/domain-error.js';
import { PrismaService } from '../../../shared/database/prisma.service.js';
import { FinanceService } from '../../finance/application/finance.service.js';
import { ServiceRequestQueries } from '../../service-requests/infrastructure/service-request.queries.js';
import type {
  ClientDetailView,
  ClientListItemView,
  ClientPageView,
  DashboardView,
  SearchResultsView,
} from '../presentation/operations.views.js';

/** Kigali is UTC+2 all year. */
const KIGALI_OFFSET_MS = 2 * 3_600_000;

const clientInclude = {
  user: {
    select: {
      email: true,
      phone: true,
      emailVerifiedAt: true,
      phoneVerifiedAt: true,
    },
  },
  _count: { select: { serviceRequests: true } },
} satisfies Prisma.ProfileInclude;
type ClientRow = Prisma.ProfileGetPayload<{ include: typeof clientInclude }>;

/** Read models for the admin dashboard, search and clients list. */
@Injectable()
export class OperationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly requests: ServiceRequestQueries,
    private readonly finance: FinanceService,
  ) {}

  async dashboard(
    includeFinance: boolean,
    now = new Date(),
  ): Promise<DashboardView> {
    const kigali = new Date(now.getTime() + KIGALI_OFFSET_MS);
    const dayStart = new Date(
      Date.UTC(
        kigali.getUTCFullYear(),
        kigali.getUTCMonth(),
        kigali.getUTCDate(),
      ) - KIGALI_OFFSET_MS,
    );
    const dayEnd = new Date(dayStart.getTime() + 864e5);
    const count = (where: Prisma.ServiceRequestWhereInput) =>
      this.prisma.serviceRequest.count({ where });

    const [
      newCount,
      oldestNew,
      pricedCount,
      paidCount,
      servicesToday,
      inProgressNow,
      openTickets,
      activeTickets,
      needsAction,
      pending,
    ] = await Promise.all([
      count({ status: { in: ['REQUESTED', 'ADJUSTMENT_REQUESTED'] } }),
      this.prisma.serviceRequest.findFirst({
        where: { status: { in: ['REQUESTED', 'ADJUSTMENT_REQUESTED'] } },
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true },
      }),
      count({ status: 'PRICED' }),
      count({ status: 'PAID' }),
      count({
        scheduledAt: { gte: dayStart, lt: dayEnd },
        status: { in: ['ASSIGNED', 'IN_PROGRESS', 'COMPLETED'] },
      }),
      count({ status: 'IN_PROGRESS' }),
      this.prisma.supportTicket.count({
        where: { status: { in: ['OPEN', 'ACTIVE'] } },
      }),
      this.prisma.supportTicket.count({ where: { status: 'ACTIVE' } }),
      this.requests.needingAction(),
      this.prisma.worker.findMany({
        where: { status: 'PENDING_VERIFICATION' },
        orderBy: { updatedAt: 'asc' },
        take: 5,
        select: {
          id: true,
          fullName: true,
          categories: true,
          createdById: true,
          createdAt: true,
        },
      }),
    ]);

    const [creators, finance] = await Promise.all([
      this.names(pending.map((w) => w.createdById)),
      includeFinance ? this.finance.overview(now) : Promise.resolve(null),
    ]);
    return {
      finance,
      counts: {
        newCount,
        oldestNewWaitingMinutes: oldestNew
          ? Math.floor((now.getTime() - oldestNew.createdAt.getTime()) / 60_000)
          : null,
        pricedCount,
        paidCount,
        servicesToday,
        inProgressNow,
        openTickets,
        activeTickets,
      },
      needsAction,
      workersToVerify: pending.map((w) => ({
        id: w.id,
        fullName: w.fullName,
        categories: w.categories,
        createdByName: w.createdById
          ? (creators.get(w.createdById) ?? null)
          : null,
        createdAt: w.createdAt,
      })),
    };
  }

  /** "Search requests, workers, clients"; SR-123 jumps to that request. */
  async search(raw: string): Promise<SearchResultsView> {
    const q = raw.trim();
    const ref = q.match(/^#?SR-?(\d+)$/i);
    const digits = q.replace(/[\s+]/g, '');
    const [requestRows, workers, clients] = await Promise.all([
      this.prisma.serviceRequest.findMany({
        where: ref
          ? { number: Number(ref[1]) }
          : {
              OR: [
                { description: { contains: q, mode: 'insensitive' } },
                { client: { fullName: { contains: q, mode: 'insensitive' } } },
              ],
            },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
        take: 5,
      }),
      this.prisma.worker.findMany({
        where: {
          OR: [
            { fullName: { contains: q, mode: 'insensitive' } },
            ...(digits.length >= 4 ? [{ phone: { contains: digits } }] : []),
          ],
        },
        select: { id: true, fullName: true, status: true, phone: true },
        take: 5,
      }),
      this.prisma.profile.findMany({
        where: {
          role: 'CLIENT',
          OR: [
            { fullName: { contains: q, mode: 'insensitive' } },
            { companyName: { contains: q, mode: 'insensitive' } },
            { user: { email: { contains: q.toLowerCase() } } },
            ...(digits.length >= 4
              ? [{ user: { phone: { contains: digits } } }]
              : []),
          ],
        },
        include: { user: { select: { email: true, phone: true } } },
        take: 5,
      }),
    ]);
    return {
      requests: await this.requests.listByIds(requestRows.map((r) => r.id)),
      workers,
      clients: clients.map((c) => ({
        id: c.id,
        fullName: c.fullName,
        email: c.user.email,
        phone: c.user.phone,
      })),
    };
  }

  async clients(filter: {
    q?: string;
    skip: number;
    take: number;
  }): Promise<ClientPageView> {
    const q = filter.q?.trim();
    const where: Prisma.ProfileWhereInput = {
      role: 'CLIENT',
      ...(q
        ? {
            OR: [
              { fullName: { contains: q, mode: 'insensitive' } },
              { companyName: { contains: q, mode: 'insensitive' } },
              { user: { email: { contains: q.toLowerCase() } } },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.profile.findMany({
        where,
        include: clientInclude,
        orderBy: { createdAt: 'desc' },
        skip: filter.skip,
        take: filter.take,
      }),
      this.prisma.profile.count({ where }),
    ]);
    const balances = await this.walletBalances(rows.map((r) => r.id));
    return {
      items: rows.map((r) => toClientItem(r, balances.get(r.id) ?? 0)),
      total,
    };
  }

  async client(id: string): Promise<ClientDetailView> {
    const row = await this.prisma.profile.findFirst({
      where: { id, role: 'CLIENT' },
      include: {
        ...clientInclude,
        addresses: { where: { isDefault: true }, take: 1 },
      },
    });
    if (!row) throw new NotFoundError('client_not_found', 'Client not found');
    const [recent, openTicketCount] = await Promise.all([
      this.prisma.serviceRequest.findMany({
        where: { clientId: id },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
        take: 10,
      }),
      this.prisma.supportTicket.count({
        where: { clientId: id, status: { in: ['OPEN', 'ACTIVE'] } },
      }),
    ]);
    const home = row.addresses[0];
    const balances = await this.walletBalances([id]);
    return {
      ...toClientItem(row, balances.get(id) ?? 0),
      district: home?.district ?? null,
      sector: home?.sector ?? null,
      street: home?.street ?? null,
      recentRequests: await this.requests.listByIds(recent.map((r) => r.id)),
      openTicketCount,
    };
  }

  private async walletBalances(ids: string[]): Promise<Map<string, number>> {
    const rows = await this.prisma.walletEntry.groupBy({
      by: ['profileId'],
      where: { profileId: { in: ids } },
      _sum: { amountRwf: true },
    });
    return new Map(rows.map((r) => [r.profileId, r._sum.amountRwf ?? 0]));
  }

  private async names(ids: Array<string | null>): Promise<Map<string, string>> {
    const unique = [...new Set(ids.filter((i): i is string => Boolean(i)))];
    if (!unique.length) return new Map();
    const rows = await this.prisma.profile.findMany({
      where: { id: { in: unique } },
      select: { id: true, fullName: true },
    });
    return new Map(rows.map((r) => [r.id, r.fullName]));
  }
}

function toClientItem(
  row: ClientRow,
  walletBalanceRwf: number,
): ClientListItemView {
  return {
    id: row.id,
    fullName: row.fullName,
    email: row.user.email,
    phone: row.user.phone,
    accountType: row.accountType,
    companyName: row.companyName,
    kycStatus: row.kycStatus,
    emailVerified: row.user.emailVerifiedAt !== null,
    phoneVerified: row.user.phoneVerifiedAt !== null,
    requestCount: row._count.serviceRequests,
    walletBalanceRwf,
    createdAt: row.createdAt,
  };
}
