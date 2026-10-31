-- A failed refund transfer returns its reserved amount
ALTER TYPE "app"."LedgerEntryKind" ADD VALUE 'REFUND_REVERSED' BEFORE 'PAYOUT';
