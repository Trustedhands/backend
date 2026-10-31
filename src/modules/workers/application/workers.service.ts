import { Injectable } from '@nestjs/common';
import type {
  Prisma,
  Worker,
  WorkerDocument,
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
  detectFileType,
  MAX_UPLOAD_BYTES,
  safeFilename,
} from '../../../shared/files/file-type.js';
import { normalizeRwandaPhone } from '../../auth/domain/credentials.js';
import {
  assertAllChecksPass,
  assertCanDecide,
  assertReadyForVerification,
  type DocumentKind,
  IDENTITY_FIELDS,
  isAssignable,
  workerChecklist,
  type WorkerProfileFacts,
} from '../domain/worker-profile.js';
import { loadWorkerStats } from '../infrastructure/worker-stats.js';
import type {
  CreateWorkerDto,
  ListWorkersQuery,
  UpdateWorkerDto,
  VerifyWorkerDto,
  WorkerDetailView,
  WorkerSummaryView,
} from '../presentation/worker.dto.js';

type WorkerWithDocs = Worker & {
  documents: Array<
    Pick<
      WorkerDocument,
      'kind' | 'filename' | 'contentType' | 'sizeBytes' | 'createdAt'
    >
  >;
};

const LIST_ORDER: Record<Worker['status'], number> = {
  PENDING_VERIFICATION: 0,
  DRAFT: 1,
  VERIFIED: 2,
  DECLINED: 3,
};

const docSelect = {
  select: {
    kind: true,
    filename: true,
    contentType: true,
    sizeBytes: true,
    createdAt: true,
  },
} as const;

@Injectable()
export class WorkersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLog,
  ) {}

  async list(query: ListWorkersQuery): Promise<WorkerSummaryView[]> {
    const q = query.q?.trim();
    const workers = await this.prisma.worker.findMany({
      where: {
        ...(query.includeInactive ? {} : { active: true }),
        ...(query.status ? { status: query.status } : {}),
        ...(query.category ? { categories: { has: query.category } } : {}),
        ...(q
          ? {
              OR: [
                { fullName: { contains: q, mode: 'insensitive' } },
                { phone: { contains: q.replace(/\s/g, '') } },
              ],
            }
          : {}),
      },
      include: { documents: docSelect },
      orderBy: { fullName: 'asc' },
      take: 200,
    });
    // Waiting for verification first, then drafts, verified, declined
    workers.sort((a, b) => LIST_ORDER[a.status] - LIST_ORDER[b.status]);
    return this.toSummaries(workers);
  }

  async get(id: string): Promise<WorkerDetailView> {
    const worker = await this.find(id);
    const [[summary], names, activity] = await Promise.all([
      this.toSummaries([worker]),
      this.names([worker.verifiedById]),
      this.audit.forEntity('worker', id),
    ]);
    return {
      ...summary!,
      dateOfBirth: worker.dateOfBirth,
      nationality: worker.nationality,
      countryOfResidence: worker.countryOfResidence,
      email: worker.email,
      province: worker.province,
      cell: worker.cell,
      village: worker.village,
      latitude: worker.latitude,
      longitude: worker.longitude,
      experience: worker.experience,
      idType: worker.idType,
      idNumber: worker.idNumber,
      nextOfKinName: worker.nextOfKinName,
      nextOfKinRelation: worker.nextOfKinRelation,
      nextOfKinPhone: worker.nextOfKinPhone,
      nextOfKinAddress: worker.nextOfKinAddress,
      nextOfKinIdNumber: worker.nextOfKinIdNumber,
      payoutMsisdn: worker.payoutMsisdn,
      payoutBankName: worker.payoutBankName,
      payoutBankAccount: worker.payoutBankAccount,
      notes: worker.notes,
      verifiedByName: worker.verifiedById
        ? (names.get(worker.verifiedById) ?? null)
        : null,
      verifiedAt: worker.verifiedAt,
      declineReason: worker.declineReason,
      documents: worker.documents.map((d) => ({
        kind: d.kind,
        filename: d.filename,
        contentType: d.contentType,
        sizeBytes: d.sizeBytes,
        uploadedAt: d.createdAt,
      })),
      checklist: workerChecklist(facts(worker)),
      activity: activity.map(({ id: eventId, action, actorName, at }) => ({
        id: eventId,
        action,
        actorName,
        at,
      })),
    };
  }

  /** "Save draft" (submit=false) or "Create & send to verification" (submit=true, after documents are uploaded). */
  async create(
    actorId: string,
    dto: CreateWorkerDto,
  ): Promise<WorkerDetailView> {
    const data = await this.normalize(dto);
    const worker = await this.prisma.$transaction(async (tx) => {
      const created = await tx.worker.create({
        data: {
          ...data,
          fullName: dto.fullName.trim(),
          gender: dto.gender,
          phone: data.phone!,
          createdById: actorId,
        },
      });
      await this.audit.record(
        {
          actorId,
          action: 'worker.created',
          entityType: 'worker',
          entityId: created.id,
        },
        tx,
      );
      return created;
    });
    return this.get(worker.id);
  }

  async update(
    actorId: string,
    id: string,
    dto: UpdateWorkerDto,
  ): Promise<WorkerDetailView> {
    const before = await this.find(id);
    const data = await this.normalize(dto);
    const changed = Object.keys(data).filter(
      (k) =>
        JSON.stringify((before as Record<string, unknown>)[k]) !==
        JSON.stringify((data as Record<string, unknown>)[k]),
    );
    // Identity changes on a verified worker must be checked again
    const reverify =
      before.status === 'VERIFIED' &&
      changed.some((k) => (IDENTITY_FIELDS as readonly string[]).includes(k));
    await this.prisma.$transaction(async (tx) => {
      await tx.worker.update({
        where: { id },
        data: {
          ...data,
          ...(reverify
            ? {
                status: 'PENDING_VERIFICATION',
                verifiedAt: null,
                verifiedById: null,
              }
            : {}),
        },
      });
      if (changed.length) {
        await this.audit.record(
          {
            actorId,
            action: reverify ? 'worker.identity_changed' : 'worker.updated',
            entityType: 'worker',
            entityId: id,
            data: { fields: changed },
          },
          tx,
        );
      }
    });
    return this.get(id);
  }

  async uploadDocument(
    actorId: string,
    id: string,
    kind: DocumentKind,
    file: { originalname: string; buffer: Buffer; size: number } | undefined,
  ): Promise<WorkerDetailView> {
    if (!file)
      throw new InvalidInputError('file_required', 'Choose a file to upload');
    if (file.size === 0 || file.size > MAX_UPLOAD_BYTES) {
      throw new InvalidInputError('file_too_large', 'Files must be under 5 MB');
    }
    const contentType = detectFileType(file.buffer);
    const allowed =
      kind === 'PHOTO'
        ? ['image/jpeg', 'image/png']
        : ['image/jpeg', 'image/png', 'application/pdf'];
    if (!contentType || !allowed.includes(contentType)) {
      throw new InvalidInputError(
        'unsupported_file',
        kind === 'PHOTO'
          ? 'Upload a JPG or PNG photo'
          : 'Upload a JPG, PNG or PDF',
      );
    }
    const worker = await this.find(id);
    const data = {
      filename: safeFilename(file.originalname, contentType),
      contentType,
      sizeBytes: file.buffer.length,
      data: new Uint8Array(file.buffer),
      uploadedById: actorId,
    };
    await this.prisma.$transaction(async (tx) => {
      await tx.workerDocument.upsert({
        where: { workerId_kind: { workerId: id, kind } },
        create: { workerId: id, kind, ...data },
        update: { ...data, createdAt: new Date() },
      });
      // A new photo or ID scan on a verified worker needs checking again
      if (worker.status === 'VERIFIED') {
        await tx.worker.update({
          where: { id },
          data: {
            status: 'PENDING_VERIFICATION',
            verifiedAt: null,
            verifiedById: null,
          },
        });
      }
      await this.audit.record(
        {
          actorId,
          action: 'worker.document_uploaded',
          entityType: 'worker',
          entityId: id,
          data: { kind },
        },
        tx,
      );
    });
    return this.get(id);
  }

  async document(id: string, kind: DocumentKind) {
    const doc = await this.prisma.workerDocument.findUnique({
      where: { workerId_kind: { workerId: id, kind } },
    });
    if (!doc)
      throw new NotFoundError('document_not_found', 'Document not found');
    return {
      filename: doc.filename,
      contentType: doc.contentType,
      data: Buffer.from(doc.data),
    };
  }

  async submitForVerification(
    actorId: string,
    id: string,
  ): Promise<WorkerDetailView> {
    const worker = await this.find(id);
    if (
      worker.status === 'PENDING_VERIFICATION' ||
      worker.status === 'VERIFIED'
    ) {
      throw new ConflictError(
        'already_submitted',
        'This worker is already verified or waiting for verification',
      );
    }
    assertReadyForVerification(facts(worker));
    await this.prisma.$transaction(async (tx) => {
      await tx.worker.update({
        where: { id },
        data: { status: 'PENDING_VERIFICATION', declineReason: null },
      });
      await this.audit.record(
        {
          actorId,
          action: 'worker.submitted',
          entityType: 'worker',
          entityId: id,
        },
        tx,
      );
    });
    return this.get(id);
  }

  async verify(
    actorId: string,
    id: string,
    dto: VerifyWorkerDto,
  ): Promise<WorkerDetailView> {
    const worker = await this.find(id);
    assertCanDecide(worker);
    assertAllChecksPass(dto.checks);
    // The profile may have been edited since it was submitted
    assertReadyForVerification(facts(worker));
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.worker.updateMany({
        where: { id, status: 'PENDING_VERIFICATION' },
        data: {
          status: 'VERIFIED',
          verifiedById: actorId,
          verifiedAt: new Date(),
          verificationChecks: dto.checks,
          declineReason: null,
        },
      });
      if (!count)
        throw new ConflictError(
          'not_pending',
          'This worker was just decided by someone else',
        );
      await this.audit.record(
        {
          actorId,
          action: 'worker.verified',
          entityType: 'worker',
          entityId: id,
          data: dto.comment ? { comment: dto.comment } : undefined,
        },
        tx,
      );
    });
    return this.get(id);
  }

  async decline(
    actorId: string,
    id: string,
    reason: string,
  ): Promise<WorkerDetailView> {
    const worker = await this.find(id);
    assertCanDecide(worker);
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.worker.updateMany({
        where: { id, status: 'PENDING_VERIFICATION' },
        data: { status: 'DECLINED', declineReason: reason.trim() },
      });
      if (!count)
        throw new ConflictError(
          'not_pending',
          'This worker was just decided by someone else',
        );
      await this.audit.record(
        {
          actorId,
          action: 'worker.declined',
          entityType: 'worker',
          entityId: id,
          data: { reason: reason.trim() },
        },
        tx,
      );
    });
    return this.get(id);
  }

  async setActive(
    actorId: string,
    id: string,
    active: boolean,
  ): Promise<WorkerDetailView> {
    await this.find(id);
    await this.prisma.$transaction(async (tx) => {
      await tx.worker.update({ where: { id }, data: { active } });
      await this.audit.record(
        {
          actorId,
          action: active ? 'worker.activated' : 'worker.deactivated',
          entityType: 'worker',
          entityId: id,
        },
        tx,
      );
    });
    return this.get(id);
  }

  /** Used by the service-requests context before holding or confirming a worker. */
  async assertAssignable(
    id: string,
    category?: string,
    db: Db = this.prisma,
  ): Promise<void> {
    const worker = await db.worker.findUnique({ where: { id } });
    if (!worker)
      throw new NotFoundError('worker_not_found', 'Worker not found');
    if (!isAssignable(worker)) {
      throw new ConflictError(
        'worker_not_assignable',
        `${worker.fullName} isn't verified and active`,
      );
    }
    if (category && !worker.categories.includes(category)) {
      throw new ConflictError(
        'worker_wrong_service',
        `${worker.fullName} doesn't offer this service`,
      );
    }
  }

  private async find(id: string): Promise<WorkerWithDocs> {
    const worker = await this.prisma.worker.findUnique({
      where: { id },
      include: { documents: docSelect },
    });
    if (!worker)
      throw new NotFoundError('worker_not_found', 'Worker not found');
    return worker;
  }

  /** Normalises phone numbers and checks service keys. Leaves absent fields absent. */
  private async normalize(
    dto: UpdateWorkerDto,
  ): Promise<Partial<Prisma.WorkerUncheckedCreateInput>> {
    const phone = (v: string | undefined) =>
      v === undefined ? undefined : v.trim() ? normalizeRwandaPhone(v) : null;
    const text = (v: string | undefined) =>
      v === undefined ? undefined : v.trim() || null;
    if (dto.categories?.length) {
      const known = await this.prisma.serviceType.count({
        where: { key: { in: dto.categories } },
      });
      if (known !== dto.categories.length)
        throw new InvalidInputError(
          'unknown_service',
          'One of the services does not exist',
        );
    }
    const normalized = {
      fullName: dto.fullName?.trim(),
      gender: dto.gender,
      dateOfBirth: dto.dateOfBirth,
      nationality: text(dto.nationality),
      countryOfResidence: text(dto.countryOfResidence),
      languages: dto.languages,
      categories: dto.categories,
      phone:
        dto.phone === undefined ? undefined : normalizeRwandaPhone(dto.phone),
      email:
        text(dto.email)?.toLowerCase() ??
        (dto.email === undefined ? undefined : null),
      province: text(dto.province),
      district: text(dto.district),
      sector: text(dto.sector),
      cell: text(dto.cell),
      village: text(dto.village),
      latitude: dto.latitude,
      longitude: dto.longitude,
      experience: text(dto.experience),
      idType: dto.idType,
      idNumber:
        dto.idNumber === undefined
          ? undefined
          : dto.idNumber.replace(/\s+/g, '') || null,
      nextOfKinName: text(dto.nextOfKinName),
      nextOfKinRelation: text(dto.nextOfKinRelation),
      nextOfKinPhone: phone(dto.nextOfKinPhone),
      nextOfKinAddress: text(dto.nextOfKinAddress),
      nextOfKinIdNumber: text(dto.nextOfKinIdNumber),
      payoutMsisdn: phone(dto.payoutMsisdn),
      payoutBankName: text(dto.payoutBankName),
      payoutBankAccount: text(dto.payoutBankAccount),
      notes: text(dto.notes),
    };
    return Object.fromEntries(
      Object.entries(normalized).filter(([, v]) => v !== undefined),
    ) as typeof normalized;
  }

  private async toSummaries(
    workers: WorkerWithDocs[],
  ): Promise<WorkerSummaryView[]> {
    const [stats, creators] = await Promise.all([
      loadWorkerStats(
        this.prisma,
        workers.map((w) => w.id),
      ),
      this.names(workers.map((w) => w.createdById)),
    ]);
    return workers.map((w) => ({
      id: w.id,
      fullName: w.fullName,
      status: w.status,
      active: w.active,
      gender: w.gender,
      languages: w.languages,
      categories: w.categories,
      phone: w.phone,
      district: w.district,
      sector: w.sector,
      hasPhoto: w.documents.some((d) => d.kind === 'PHOTO'),
      createdByName: w.createdById
        ? (creators.get(w.createdById) ?? null)
        : null,
      createdAt: w.createdAt,
      ...stats.get(w.id)!,
    }));
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

function facts(w: WorkerWithDocs): WorkerProfileFacts {
  return {
    fullName: w.fullName,
    dateOfBirth: w.dateOfBirth,
    languages: w.languages,
    categories: w.categories,
    phone: w.phone,
    district: w.district,
    sector: w.sector,
    idType: w.idType,
    idNumber: w.idNumber,
    nextOfKinName: w.nextOfKinName,
    nextOfKinPhone: w.nextOfKinPhone,
    payoutMsisdn: w.payoutMsisdn,
    payoutBankName: w.payoutBankName,
    payoutBankAccount: w.payoutBankAccount,
    documents: w.documents.map((d) => d.kind),
  };
}
