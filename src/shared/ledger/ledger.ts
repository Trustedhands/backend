import type {
  LedgerAccount,
  LedgerEntryKind,
  Prisma,
} from '../../generated/prisma/client.js';
import type { Db } from '../database/prisma.service.js';

export interface LedgerLine {
  account: LedgerAccount;
  kind: LedgerEntryKind;
  /** Positive credits, negative debits; zero lines are skipped */
  amountRwf: number;
  workerId?: string;
  serviceRequestId?: string;
  paymentId?: string;
  refundId?: string;
  payoutId?: string;
}

/** Appends ledger lines. Call inside the transaction that moves the money. */
export async function postLedger(db: Db, lines: LedgerLine[]): Promise<void> {
  const data = lines.filter((l) => l.amountRwf !== 0);
  if (data.length) await db.ledgerEntry.createMany({ data });
}

/** Sum of an account's entries (optionally narrowed, e.g. one worker or request). */
export async function ledgerBalance(
  db: Db,
  where: Prisma.LedgerEntryWhereInput,
): Promise<number> {
  const result = await db.ledgerEntry.aggregate({
    where,
    _sum: { amountRwf: true },
  });
  return result._sum.amountRwf ?? 0;
}
