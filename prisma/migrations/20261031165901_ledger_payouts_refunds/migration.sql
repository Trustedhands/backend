-- CreateEnum
CREATE TYPE "app"."LedgerAccount" AS ENUM ('ESCROW', 'PLATFORM', 'WORKER');

-- CreateEnum
CREATE TYPE "app"."LedgerEntryKind" AS ENUM ('PAYMENT_RECEIVED', 'RELEASED_TO_WORKER', 'RELEASED_TO_PLATFORM', 'REFUND', 'PAYOUT', 'PAYOUT_REVERSED');

-- CreateEnum
CREATE TYPE "app"."PayoutMethod" AS ENUM ('MOMO', 'BANK');

-- AlterTable
ALTER TABLE "app"."refunds" ADD COLUMN     "chargedTo" "app"."LedgerAccount" NOT NULL,
ADD COLUMN     "completedAt" TIMESTAMP(3),
ADD COLUMN     "failureReason" TEXT,
ADD COLUMN     "msisdn" TEXT NOT NULL,
ADD COLUMN     "providerReference" UUID NOT NULL,
ADD COLUMN     "providerTransactionId" TEXT,
ADD COLUMN     "status" "app"."PaymentStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "ticketId" UUID,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- AlterTable
ALTER TABLE "app"."service_requests" ADD COLUMN     "releasedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "app"."ledger_entries" (
    "id" UUID NOT NULL,
    "account" "app"."LedgerAccount" NOT NULL,
    "workerId" UUID,
    "kind" "app"."LedgerEntryKind" NOT NULL,
    "amountRwf" INTEGER NOT NULL,
    "serviceRequestId" UUID,
    "paymentId" UUID,
    "refundId" UUID,
    "payoutId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."payouts" (
    "id" UUID NOT NULL,
    "workerId" UUID NOT NULL,
    "amountRwf" INTEGER NOT NULL,
    "method" "app"."PayoutMethod" NOT NULL,
    "status" "app"."PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "destination" TEXT NOT NULL,
    "initiatedById" UUID NOT NULL,
    "providerReference" UUID,
    "providerTransactionId" TEXT,
    "manualReference" TEXT,
    "failureReason" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payouts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ledger_entries_account_createdAt_idx" ON "app"."ledger_entries"("account", "createdAt");

-- CreateIndex
CREATE INDEX "ledger_entries_workerId_idx" ON "app"."ledger_entries"("workerId");

-- CreateIndex
CREATE INDEX "ledger_entries_serviceRequestId_idx" ON "app"."ledger_entries"("serviceRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "payouts_providerReference_key" ON "app"."payouts"("providerReference");

-- CreateIndex
CREATE INDEX "payouts_workerId_createdAt_idx" ON "app"."payouts"("workerId", "createdAt");

-- CreateIndex
CREATE INDEX "payouts_status_idx" ON "app"."payouts"("status");

-- CreateIndex
CREATE UNIQUE INDEX "refunds_providerReference_key" ON "app"."refunds"("providerReference");

-- CreateIndex
CREATE INDEX "refunds_status_idx" ON "app"."refunds"("status");

-- AddForeignKey
ALTER TABLE "app"."ledger_entries" ADD CONSTRAINT "ledger_entries_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "app"."workers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."ledger_entries" ADD CONSTRAINT "ledger_entries_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "app"."payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."ledger_entries" ADD CONSTRAINT "ledger_entries_refundId_fkey" FOREIGN KEY ("refundId") REFERENCES "app"."refunds"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."ledger_entries" ADD CONSTRAINT "ledger_entries_payoutId_fkey" FOREIGN KEY ("payoutId") REFERENCES "app"."payouts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."payouts" ADD CONSTRAINT "payouts_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "app"."workers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Guards Prisma can't express
ALTER TABLE "app"."ledger_entries" ADD CONSTRAINT "ledger_worker_account"
  CHECK (("account" = 'WORKER') = ("workerId" IS NOT NULL));
ALTER TABLE "app"."ledger_entries" ADD CONSTRAINT "ledger_nonzero" CHECK ("amountRwf" <> 0);
ALTER TABLE "app"."payouts" ADD CONSTRAINT "payouts_amount_positive" CHECK ("amountRwf" > 0);
ALTER TABLE "app"."refunds" ADD CONSTRAINT "refunds_charged_to" CHECK ("chargedTo" IN ('ESCROW', 'PLATFORM'));
