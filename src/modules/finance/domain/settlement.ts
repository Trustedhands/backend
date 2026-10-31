import {
  ConflictError,
  InvalidInputError,
} from '../../../shared/domain/domain-error.js';

/**
 * How escrow is split when a job is released. Refunds made before release
 * reduce the worker's share first (they usually reflect work not done); the
 * platform keeps whatever is left.
 */
export function splitEscrow(input: {
  escrowRwf: number;
  workerFeeRwf: number;
  refundedRwf: number;
}): {
  workerRwf: number;
  platformRwf: number;
} {
  const workerRwf = Math.min(
    input.escrowRwf,
    Math.max(0, input.workerFeeRwf - input.refundedRwf),
  );
  return { workerRwf, platformRwf: input.escrowRwf - workerRwf };
}

/** Before release a refund comes out of escrow; afterwards the platform bears it. */
export function refundSource(released: boolean): 'ESCROW' | 'PLATFORM' {
  return released ? 'PLATFORM' : 'ESCROW';
}

export function assertRefundable(input: {
  amountRwf: number;
  paidRwf: number;
  /** Successful and pending refunds on the same payment */
  alreadyRefundedRwf: number;
  /** Escrow left on the request, when the refund comes from escrow */
  escrowRwf: number | null;
}): void {
  if (!Number.isInteger(input.amountRwf) || input.amountRwf <= 0) {
    throw new InvalidInputError(
      'invalid_amount',
      'Refund a whole amount above zero',
    );
  }
  const remaining = input.paidRwf - input.alreadyRefundedRwf;
  if (input.amountRwf > remaining) {
    throw new ConflictError(
      'refund_exceeds_payment',
      `At most ${remaining} RWF can still be refunded on this payment`,
    );
  }
  if (input.escrowRwf !== null && input.amountRwf > input.escrowRwf) {
    throw new ConflictError(
      'refund_exceeds_escrow',
      `Only ${input.escrowRwf} RWF is still held in escrow`,
    );
  }
}

/** When an unconfirmed job is completed automatically and its money released. */
export function releaseDueAt(
  scheduledAt: Date,
  durationHours: number,
  releaseAfterHours: number,
): Date {
  return new Date(
    scheduledAt.getTime() + (durationHours + releaseAfterHours) * 3_600_000,
  );
}

export function assertPayoutAmount(
  amountRwf: number,
  balanceRwf: number,
): void {
  if (!Number.isInteger(amountRwf) || amountRwf <= 0) {
    throw new InvalidInputError(
      'invalid_amount',
      'Pay out a whole amount above zero',
    );
  }
  if (amountRwf > balanceRwf) {
    throw new ConflictError(
      'insufficient_balance',
      `The worker's wallet only has ${balanceRwf} RWF`,
    );
  }
}
