-- CreateEnum
CREATE TYPE "app"."HomeType" AS ENUM ('APARTMENT', 'HOUSE', 'VILLA');

-- CreateEnum
CREATE TYPE "app"."HomeArea" AS ENUM ('KITCHEN', 'LIVING_ROOM', 'DINING', 'BEDROOMS', 'BATHROOMS', 'WINDOWS', 'LAUNDRY_AREA', 'COMPOUND', 'GARDEN');

-- CreateEnum
CREATE TYPE "app"."RefundDestination" AS ENUM ('MOMO', 'WALLET');

-- AlterEnum
ALTER TYPE "app"."WalletEntryType" ADD VALUE 'TOP_UP';

-- AlterTable
ALTER TABLE "app"."refunds" ADD COLUMN     "destination" "app"."RefundDestination" NOT NULL DEFAULT 'MOMO',
ALTER COLUMN "msisdn" DROP NOT NULL,
ALTER COLUMN "providerReference" DROP NOT NULL;

-- AlterTable
ALTER TABLE "app"."service_requests" ADD COLUMN     "areas" "app"."HomeArea"[] DEFAULT ARRAY[]::"app"."HomeArea"[],
ADD COLUMN     "bathrooms" SMALLINT,
ADD COLUMN     "bedrooms" SMALLINT,
ADD COLUMN     "homeType" "app"."HomeType";

-- AlterTable
ALTER TABLE "app"."service_types" ADD COLUMN     "asksAreas" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "asksHomeSize" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "app"."wallet_entries" ADD COLUMN     "createdById" UUID,
ADD COLUMN     "paymentId" UUID,
ADD COLUMN     "topUpId" UUID;

-- CreateTable
CREATE TABLE "app"."wallet_top_ups" (
    "id" UUID NOT NULL,
    "profileId" UUID NOT NULL,
    "amountRwf" INTEGER NOT NULL,
    "status" "app"."PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "msisdn" TEXT NOT NULL,
    "providerReference" UUID NOT NULL,
    "providerTransactionId" TEXT,
    "failureReason" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wallet_top_ups_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "wallet_top_ups_providerReference_key" ON "app"."wallet_top_ups"("providerReference");

-- CreateIndex
CREATE INDEX "wallet_top_ups_profileId_createdAt_idx" ON "app"."wallet_top_ups"("profileId", "createdAt");

-- CreateIndex
CREATE INDEX "wallet_top_ups_status_idx" ON "app"."wallet_top_ups"("status");

-- CreateIndex
CREATE UNIQUE INDEX "wallet_entries_paymentId_key" ON "app"."wallet_entries"("paymentId");

-- CreateIndex
CREATE UNIQUE INDEX "wallet_entries_topUpId_key" ON "app"."wallet_entries"("topUpId");

-- AddForeignKey
ALTER TABLE "app"."wallet_entries" ADD CONSTRAINT "wallet_entries_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "app"."payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."wallet_entries" ADD CONSTRAINT "wallet_entries_topUpId_fkey" FOREIGN KEY ("topUpId") REFERENCES "app"."wallet_top_ups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."wallet_top_ups" ADD CONSTRAINT "wallet_top_ups_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "app"."profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Which services ask for household details (ops can change these in Services)
UPDATE "app"."service_types" SET "asksHomeSize" = true, "asksAreas" = true WHERE "key" IN ('CLEANING', 'HOUSE_HELP');
UPDATE "app"."service_types" SET "asksHomeSize" = true WHERE "key" = 'LAUNDRY';
UPDATE "app"."service_types" SET "asksAreas" = true WHERE "key" = 'REPAIRS';
