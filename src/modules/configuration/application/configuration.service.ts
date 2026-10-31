import { Injectable } from '@nestjs/common';
import {
  Prisma,
  type PlatformSettings,
  type ServiceType,
} from '../../../generated/prisma/client.js';
import { AuditLog } from '../../../shared/audit/audit-log.js';
import {
  ConflictError,
  InvalidInputError,
  NotFoundError,
} from '../../../shared/domain/domain-error.js';
import {
  type Db,
  PrismaService,
} from '../../../shared/database/prisma.service.js';
import {
  MATCHING_CRITERIA,
  type CreateServiceTypeDto,
  type MatchingCriterion,
  type ServiceTypeView,
  type SettingsView,
  type UpdateServiceTypeDto,
  type UpdateSettingsDto,
} from '../presentation/configuration.dto.js';

@Injectable()
export class ConfigurationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLog,
  ) {}

  async settings(db: Db = this.prisma): Promise<SettingsView> {
    return toSettingsView(
      await db.platformSettings.findUniqueOrThrow({ where: { id: 1 } }),
    );
  }

  async updateSettings(
    actorId: string,
    dto: UpdateSettingsDto,
  ): Promise<SettingsView> {
    if (
      dto.matchingPriority &&
      dto.matchingPriority.length !== MATCHING_CRITERIA.length
    ) {
      throw new InvalidInputError(
        'invalid_priority',
        'Order all five matching criteria',
      );
    }
    return this.prisma.$transaction(async (tx) => {
      const before = toSettingsView(
        await tx.platformSettings.findUniqueOrThrow({ where: { id: 1 } }),
      );
      const after = toSettingsView(
        await tx.platformSettings.update({ where: { id: 1 }, data: dto }),
      );
      const changes = diff(before, after);
      if (Object.keys(changes).length) {
        await this.audit.record(
          {
            actorId,
            action: 'settings.updated',
            entityType: 'settings',
            entityId: '1',
            data: changes as Prisma.InputJsonValue,
          },
          tx,
        );
      }
      return after;
    });
  }

  async serviceTypes(): Promise<ServiceTypeView[]> {
    const rows = await this.prisma.serviceType.findMany({
      orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }],
    });
    return rows.map(toServiceTypeView);
  }

  async visibleServiceTypes() {
    const rows = await this.prisma.serviceType.findMany({
      where: { visible: true },
      orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }],
      select: { key: true, label: true, feeType: true },
    });
    return rows;
  }

  /** Used when a client submits a request. */
  async requireVisibleServiceType(key: string): Promise<ServiceType> {
    const type = await this.prisma.serviceType.findUnique({ where: { key } });
    if (!type || !type.visible) {
      throw new InvalidInputError(
        'unknown_service',
        "We don't offer that service right now",
      );
    }
    return type;
  }

  async createServiceType(
    actorId: string,
    dto: CreateServiceTypeDto,
  ): Promise<ServiceTypeView> {
    try {
      const created = await this.prisma.serviceType.create({
        data: { ...dto, label: dto.label.trim() },
      });
      await this.audit.record({
        actorId,
        action: 'service_type.created',
        entityType: 'service_type',
        entityId: created.key,
        data: { ...dto },
      });
      return toServiceTypeView(created);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictError(
          'service_type_exists',
          `A service with key ${dto.key} already exists`,
        );
      }
      throw error;
    }
  }

  async updateServiceType(
    actorId: string,
    key: string,
    dto: UpdateServiceTypeDto,
  ): Promise<ServiceTypeView> {
    const before = await this.prisma.serviceType.findUnique({ where: { key } });
    if (!before)
      throw new NotFoundError('service_type_not_found', 'Service not found');
    if (dto.key && dto.key !== key) {
      throw new InvalidInputError(
        'key_immutable',
        "A service's key can't change; hide it and add a new one",
      );
    }
    const { key: _ignored, ...data } = dto;
    const after = await this.prisma.serviceType.update({
      where: { key },
      data,
    });
    const changes = diff(toServiceTypeView(before), toServiceTypeView(after));
    if (Object.keys(changes).length) {
      await this.audit.record({
        actorId,
        action: 'service_type.updated',
        entityType: 'service_type',
        entityId: key,
        data: changes as Prisma.InputJsonValue,
      });
    }
    return toServiceTypeView(after);
  }
}

function toSettingsView(s: PlatformSettings): SettingsView {
  return {
    serviceFeeRwf: s.serviceFeeRwf,
    matchFeeRwf: s.matchFeeRwf,
    releaseAfterHours: s.releaseAfterHours,
    matchingPriority: s.matchingPriority as MatchingCriterion[],
    momoEnabled: s.momoEnabled,
    cardEnabled: s.cardEnabled,
    clientWalletEnabled: s.clientWalletEnabled,
    vouchersEnabled: s.vouchersEnabled,
    updatedAt: s.updatedAt,
  };
}

function toServiceTypeView(t: ServiceType): ServiceTypeView {
  return {
    key: t.key,
    label: t.label,
    pricingGuide: t.pricingGuide,
    feeType: t.feeType,
    visible: t.visible,
    sortOrder: t.sortOrder,
  };
}

/** { field: { from, to } } for fields that changed (ignores timestamps). */
function diff<T extends object>(
  before: T,
  after: T,
): Record<string, { from: unknown; to: unknown }> {
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const key of Object.keys(after) as Array<keyof T>) {
    if (key === 'updatedAt') continue;
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
      changes[String(key)] = { from: before[key], to: after[key] };
    }
  }
  return changes;
}
