/**
 * Base class for errors raised by domain and application code. They carry a
 * stable machine-readable `code` and are mapped to HTTP responses by
 * DomainExceptionFilter, so domain code never depends on HTTP.
 */
export abstract class DomainError extends Error {
  abstract readonly kind:
    | 'unauthorized'
    | 'not_found'
    | 'conflict'
    | 'invalid'
    | 'forbidden'
    | 'unavailable';

  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

/** Credentials or a session are missing, wrong or expired. */
export class UnauthorizedError extends DomainError {
  readonly kind = 'unauthorized';
}

export class NotFoundError extends DomainError {
  readonly kind = 'not_found';
}

/** The operation is not allowed in the aggregate's current state. */
export class ConflictError extends DomainError {
  readonly kind = 'conflict';
}

/** Input breaks a business rule. */
export class InvalidInputError extends DomainError {
  readonly kind = 'invalid';
}

export class ForbiddenError extends DomainError {
  readonly kind = 'forbidden';
}

/** An external dependency (e.g. MoMo) failed or is not configured. */
export class UnavailableError extends DomainError {
  readonly kind = 'unavailable';
}
