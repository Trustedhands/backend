import type { Db } from '../../../shared/database/prisma.service.js';
import type { ServiceRequest } from './service-request.js';

/**
 * Persistence port for the ServiceRequest aggregate. Pass `db` to take part in
 * a caller-managed transaction.
 */
export abstract class ServiceRequestRepository {
  abstract findById(id: string, db?: Db): Promise<ServiceRequest | null>;

  /** Inserts a newly submitted request and returns it with its assigned number. */
  abstract create(request: ServiceRequest, db?: Db): Promise<ServiceRequest>;

  /**
   * Persists changes and the recorded timeline. Throws ConflictError if the
   * request was modified since it was loaded (optimistic locking).
   */
  abstract save(request: ServiceRequest, db?: Db): Promise<void>;

  abstract hasPendingPayment(id: string, db?: Db): Promise<boolean>;
}
