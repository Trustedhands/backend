import { Injectable } from '@nestjs/common';
import {
  ConflictError,
  NotFoundError,
} from '../../../shared/domain/domain-error.js';
import { ProfilesService } from '../../identity/application/profiles.service.js';
import { WorkersService } from '../../workers/application/workers.service.js';
import {
  ServiceRequest,
  type SubmitServiceRequest,
} from '../domain/service-request.js';
import { ServiceRequestRepository } from '../domain/service-request.repository.js';

type Actor = { id: string; isAdmin: boolean };

/** Use cases that change service requests. Reads go through ServiceRequestQueries. */
@Injectable()
export class ServiceRequestsService {
  constructor(
    private readonly requests: ServiceRequestRepository,
    private readonly profiles: ProfilesService,
    private readonly workers: WorkersService,
  ) {}

  async submit(input: SubmitServiceRequest): Promise<{ id: string }> {
    await this.profiles.require(input.clientId);
    const created = await this.requests.create(ServiceRequest.submit(input));
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

  async price(
    adminId: string,
    id: string,
    input: { workerFeeRwf: number; serviceFeeRwf: number; note?: string },
  ): Promise<void> {
    const request = await this.load(id, { id: adminId, isAdmin: true });
    // Changing the price mid-payment would leave the MoMo charge and the quote out of step
    await this.assertNoPendingPayment(id);
    request.price(input, adminId);
    await this.requests.save(request);
  }

  async assignWorker(
    adminId: string,
    id: string,
    workerId: string,
  ): Promise<void> {
    const request = await this.load(id, { id: adminId, isAdmin: true });
    await this.workers.assertAssignable(workerId);
    request.assignWorker(workerId, adminId);
    await this.requests.save(request);
  }

  async start(adminId: string, id: string): Promise<void> {
    const request = await this.load(id, { id: adminId, isAdmin: true });
    request.start(adminId);
    await this.requests.save(request);
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
