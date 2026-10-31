import { Injectable } from '@nestjs/common';
import type { ServiceRequest as ServiceRequestRow } from '../../../generated/prisma/client.js';
import { ConflictError } from '../../../shared/domain/domain-error.js';
import {
  type Db,
  PrismaService,
} from '../../../shared/database/prisma.service.js';
import { ServiceRequest } from '../domain/service-request.js';
import { ServiceRequestRepository } from '../domain/service-request.repository.js';

@Injectable()
export class PrismaServiceRequestRepository extends ServiceRequestRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async findById(
    id: string,
    db: Db = this.prisma,
  ): Promise<ServiceRequest | null> {
    const row = await db.serviceRequest.findUnique({ where: { id } });
    return row ? toDomain(row) : null;
  }

  async create(
    request: ServiceRequest,
    db: Db = this.prisma,
  ): Promise<ServiceRequest> {
    const s = request.toSnapshot();
    const changes = request.pullChanges();
    const row = await db.serviceRequest.create({
      data: {
        id: s.id,
        clientId: s.clientId,
        category: s.category,
        description: s.description,
        scheduledAt: s.scheduledAt,
        durationHours: s.durationHours,
        preferredGender: s.preferredGender,
        preferredLanguages: s.preferredLanguages,
        addressDistrict: s.address.district,
        addressSector: s.address.sector,
        addressStreet: s.address.street,
        addressLatitude: s.address.latitude,
        addressLongitude: s.address.longitude,
        status: s.status,
        createdAt: s.createdAt,
        events: {
          create: changes.map((c) => ({
            status: c.status,
            actorId: c.actorId,
            note: c.note,
            createdAt: c.at,
          })),
        },
      },
    });
    return toDomain(row);
  }

  async save(request: ServiceRequest, db: Db = this.prisma): Promise<void> {
    const s = request.toSnapshot();
    const changes = request.pullChanges();

    const persist = async (tx: Db) => {
      const { count } = await tx.serviceRequest.updateMany({
        where: { id: s.id, version: s.version },
        data: {
          status: s.status,
          workerFeeRwf: s.quote?.workerFeeRwf ?? null,
          serviceFeeRwf: s.quote?.serviceFeeRwf ?? null,
          quoteNote: s.quote?.note ?? null,
          pricedAt: s.quote?.pricedAt ?? null,
          discountRwf: s.discountRwf,
          adjustmentNote: s.adjustmentNote,
          assignedWorkerId: s.assignedWorkerId,
          cancellationReason: s.cancellationReason,
          completedAt: s.completedAt,
          version: { increment: 1 },
        },
      });
      if (count === 0) {
        throw new ConflictError(
          'concurrent_modification',
          'This request was changed by someone else. Reload and try again.',
        );
      }
      if (changes.length) {
        await tx.serviceRequestEvent.createMany({
          data: changes.map((c) => ({
            serviceRequestId: s.id,
            status: c.status,
            actorId: c.actorId,
            note: c.note,
            createdAt: c.at,
          })),
        });
      }
    };

    // Join the caller's transaction if there is one; otherwise open our own.
    if ('$transaction' in db) {
      await db.$transaction(persist);
    } else {
      await persist(db);
    }
  }

  async hasPendingPayment(id: string, db: Db = this.prisma): Promise<boolean> {
    const count = await db.payment.count({
      where: { serviceRequestId: id, status: 'PENDING' },
    });
    return count > 0;
  }
}

function toDomain(row: ServiceRequestRow): ServiceRequest {
  return ServiceRequest.rehydrate({
    id: row.id,
    number: row.number,
    clientId: row.clientId,
    category: row.category,
    description: row.description,
    scheduledAt: row.scheduledAt,
    durationHours: row.durationHours.toNumber(),
    preferredGender: row.preferredGender,
    preferredLanguages: row.preferredLanguages,
    address: {
      district: row.addressDistrict,
      sector: row.addressSector,
      street: row.addressStreet,
      latitude: row.addressLatitude,
      longitude: row.addressLongitude,
    },
    status: row.status,
    quote:
      row.workerFeeRwf !== null && row.serviceFeeRwf !== null && row.pricedAt
        ? {
            workerFeeRwf: row.workerFeeRwf,
            serviceFeeRwf: row.serviceFeeRwf,
            note: row.quoteNote,
            pricedAt: row.pricedAt,
          }
        : null,
    discountRwf: row.discountRwf,
    adjustmentNote: row.adjustmentNote,
    assignedWorkerId: row.assignedWorkerId,
    cancellationReason: row.cancellationReason,
    completedAt: row.completedAt,
    version: row.version,
    createdAt: row.createdAt,
  });
}
