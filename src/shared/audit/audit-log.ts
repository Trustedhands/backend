import { Global, Injectable, Module } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.js';
import { type Db, PrismaService } from '../database/prisma.service.js';

export interface AuditEntry {
  /** Null for the system, e.g. scheduled jobs */
  actorId: string | null;
  /** e.g. worker.verified, settings.updated */
  action: string;
  entityType:
    | 'worker'
    | 'service_request'
    | 'settings'
    | 'service_type'
    | 'team'
    | 'ticket'
    | 'payment'
    | 'payout'
    | 'client';
  entityId: string;
  data?: Prisma.InputJsonValue;
}

/** "Every change is logged with who made it." Pass `db` to record inside a transaction. */
@Injectable()
export class AuditLog {
  constructor(private readonly prisma: PrismaService) {}

  async record(entry: AuditEntry, db: Db = this.prisma): Promise<void> {
    await db.auditEvent.create({ data: entry });
  }

  /** Newest first, with the actor's name. */
  async forEntity(
    entityType: AuditEntry['entityType'],
    entityId: string,
    take = 50,
  ) {
    const events = await this.prisma.auditEvent.findMany({
      where: { entityType, entityId },
      orderBy: { createdAt: 'desc' },
      take,
    });
    const actorIds = [
      ...new Set(events.flatMap((e) => (e.actorId ? [e.actorId] : []))),
    ];
    const actors = await this.prisma.profile.findMany({
      where: { id: { in: actorIds } },
      select: { id: true, fullName: true },
    });
    const names = new Map(actors.map((a) => [a.id, a.fullName]));
    return events.map((e) => ({
      id: e.id,
      action: e.action,
      actorName: e.actorId
        ? (names.get(e.actorId) ?? 'Former staff')
        : 'System',
      data: e.data,
      at: e.createdAt,
    }));
  }
}

@Global()
@Module({ providers: [AuditLog], exports: [AuditLog] })
export class AuditModule {}
