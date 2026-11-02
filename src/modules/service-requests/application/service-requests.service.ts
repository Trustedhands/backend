import { Injectable, Logger } from '@nestjs/common';
import {
  ConflictError,
  InvalidInputError,
  NotFoundError,
} from '../../../shared/domain/domain-error.js';
import { PrismaService } from '../../../shared/database/prisma.service.js';
import { formatRequestRef } from '../../../shared/http/references.js';
import { Mailer, SmsSender } from '../../auth/application/ports.js';
import { ConfigurationService } from '../../configuration/application/configuration.service.js';
import { ProfilesService } from '../../identity/application/profiles.service.js';
import { WorkersService } from '../../workers/application/workers.service.js';
import {
  type RequestKind,
  ServiceRequest,
  type SubmitServiceRequest,
} from '../domain/service-request.js';
import { ServiceRequestRepository } from '../domain/service-request.repository.js';
import { paymentReminderEmail } from './request-emails.js';

type Actor = { id: string; isAdmin: boolean };

/** Use cases that change service requests. Reads go through ServiceRequestQueries. */
@Injectable()
export class ServiceRequestsService {
  private readonly logger = new Logger(ServiceRequestsService.name);

  constructor(
    private readonly requests: ServiceRequestRepository,
    private readonly profiles: ProfilesService,
    private readonly workers: WorkersService,
    private readonly config: ConfigurationService,
    private readonly prisma: PrismaService,
    private readonly mailer: Mailer,
    private readonly sms: SmsSender,
  ) {}

  /** The kind comes from the service; "either" services let the client choose. */
  async submit(
    input: Omit<SubmitServiceRequest, 'kind'> & { kind?: RequestKind },
  ): Promise<{ id: string }> {
    await this.profiles.require(input.clientId);
    const service = await this.config.requireVisibleServiceType(input.category);
    const kind: RequestKind =
      service.feeType === 'MATCH'
        ? 'PLACEMENT'
        : service.feeType === 'SERVICE'
          ? 'VISIT'
          : (input.kind ?? 'VISIT');
    const created = await this.requests.create(
      ServiceRequest.submit({ ...input, kind }, new Date(), {
        homeSize: service.asksHomeSize,
        areas: service.asksAreas,
      }),
    );
    return { id: created.id };
  }

  async requestAdjustment(
    clientId: string,
    id: string,
    note: string,
  ): Promise<void> {
    const request = await this.load(id, { id: clientId, isAdmin: false });
    await this.assertNoPendingPayment(id);
    request.requestAdjustment(note, clientId);
    await this.requests.save(request);
  }

  async cancel(actor: Actor, id: string, reason: string): Promise<void> {
    const request = await this.load(id, actor);
    await this.assertNoPendingPayment(id);
    request.cancel(reason, actor);
    await this.requests.save(request);
  }

  async complete(actor: Actor, id: string): Promise<void> {
    const request = await this.load(id, actor);
    request.complete(actor.id);
    await this.requests.save(request);
  }

  /**
   * "Send price to client". Ops sets the worker fee and holds a worker; the
   * platform fee comes from Settings (placements pay the match fee only).
   */
  async price(
    adminId: string,
    id: string,
    input: { workerFeeRwf: number; workerId: string; note?: string },
  ): Promise<void> {
    const request = await this.load(id, { id: adminId, isAdmin: true });
    // Changing the price mid-payment would leave the MoMo charge and the quote out of step
    await this.assertNoPendingPayment(id);
    await this.workers.assertAssignable(input.workerId, request.category);
    const settings = await this.config.settings();
    const fees =
      request.kind === 'PLACEMENT'
        ? { workerFeeRwf: 0, serviceFeeRwf: settings.matchFeeRwf }
        : {
            workerFeeRwf: input.workerFeeRwf,
            serviceFeeRwf: settings.serviceFeeRwf,
          };
    if (request.kind === 'VISIT' && input.workerFeeRwf <= 0) {
      throw new InvalidInputError('invalid_fee', 'Set the worker fee');
    }
    request.price(
      { ...fees, workerId: input.workerId, note: input.note },
      adminId,
    );
    await this.requests.save(request);
  }

  /** "Confirm worker" after payment: the held worker unless another is given. */
  async assignWorker(
    adminId: string,
    id: string,
    workerId?: string,
  ): Promise<void> {
    const request = await this.load(id, { id: adminId, isAdmin: true });
    const chosen = workerId ?? request.assignedWorkerId;
    if (chosen) await this.workers.assertAssignable(chosen, request.category);
    request.assignWorker(chosen ?? null, adminId);
    await this.requests.save(request);
  }

  async start(adminId: string, id: string): Promise<void> {
    const request = await this.load(id, { id: adminId, isAdmin: true });
    request.start(adminId);
    await this.requests.save(request);
  }

  /** "Remind": nudges a client who hasn't paid a sent price, by email and SMS. */
  async remind(adminId: string, id: string): Promise<void> {
    const request = await this.load(id, { id: adminId, isAdmin: true });
    request.remind();
    await this.requests.save(request);

    const client = await this.prisma.profile.findUniqueOrThrow({
      where: { id: request.clientId },
      include: { user: { select: { email: true, phone: true } } },
    });
    const service = await this.prisma.serviceType.findUniqueOrThrow({
      where: { key: request.category },
    });
    const reference = formatRequestRef(request.number!);
    const delivered = await Promise.allSettled([
      this.mailer.send(
        paymentReminderEmail(
          client.user.email,
          client.fullName,
          service.label,
          reference,
          request.totalRwf!,
        ),
      ),
      client.user.phone
        ? this.sms.send(
            client.user.phone,
            `TrustedHands: your price for ${service.label} (${reference}) is ready. Open the app to review and pay.`,
          )
        : Promise.resolve(),
    ]);
    for (const result of delivered) {
      if (result.status === 'rejected')
        this.logger.warn(
          `Reminder for ${reference} partly failed: ${String(result.reason)}`,
        );
    }
  }

  /** Clients can only touch their own requests; others look like they don't exist. */
  private async load(id: string, actor: Actor): Promise<ServiceRequest> {
    const request = await this.requests.findById(id);
    if (!request || (!actor.isAdmin && !request.isOwnedBy(actor.id))) {
      throw new NotFoundError('service_request_not_found', 'Request not found');
    }
    return request;
  }

  private async assertNoPendingPayment(id: string): Promise<void> {
    if (await this.requests.hasPendingPayment(id)) {
      throw new ConflictError(
        'payment_in_progress',
        'A payment is in progress for this request. Wait for it to finish first.',
      );
    }
  }
}
