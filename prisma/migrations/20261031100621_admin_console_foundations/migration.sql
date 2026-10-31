/*
  Warnings:

  - You are about to drop the column `idVerified` on the `workers` table. All the data in the column will be lost.
  - You are about to drop the column `photoPath` on the `workers` table. All the data in the column will be lost.
  - The `categories` column on the `workers` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - Changed the type of `category` on the `service_requests` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- CreateEnum
CREATE TYPE "app"."StaffRole" AS ENUM ('SUPER_ADMIN', 'VERIFICATION_LEAD', 'FINANCE', 'CUSTOMER_SERVICE');

-- CreateEnum
CREATE TYPE "app"."WorkerStatus" AS ENUM ('DRAFT', 'PENDING_VERIFICATION', 'VERIFIED', 'DECLINED');

-- CreateEnum
CREATE TYPE "app"."WorkerDocumentKind" AS ENUM ('PHOTO', 'ID_FRONT', 'ID_BACK');

-- CreateEnum
CREATE TYPE "app"."ServiceFeeType" AS ENUM ('SERVICE', 'MATCH', 'EITHER');

-- CreateEnum
CREATE TYPE "app"."RequestKind" AS ENUM ('VISIT', 'PLACEMENT');

-- AlterTable
ALTER TABLE "app"."profiles" ADD COLUMN     "staffDisabledAt" TIMESTAMP(3),
ADD COLUMN     "staffRole" "app"."StaffRole";

-- AlterTable
ALTER TABLE "app"."service_requests" ADD COLUMN     "kind" "app"."RequestKind" NOT NULL DEFAULT 'VISIT',
ADD COLUMN     "remindedAt" TIMESTAMP(3),
DROP COLUMN "category",
ADD COLUMN     "category" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "app"."support_tickets" ADD COLUMN     "assignedToId" UUID;

-- AlterTable
ALTER TABLE "app"."users" ADD COLUMN     "lastActiveAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "app"."workers" DROP COLUMN "idVerified",
DROP COLUMN "photoPath",
ADD COLUMN     "cell" TEXT,
ADD COLUMN     "countryOfResidence" TEXT,
ADD COLUMN     "createdById" UUID,
ADD COLUMN     "dateOfBirth" DATE,
ADD COLUMN     "declineReason" TEXT,
ADD COLUMN     "district" TEXT,
ADD COLUMN     "email" TEXT,
ADD COLUMN     "experience" TEXT,
ADD COLUMN     "idNumber" TEXT,
ADD COLUMN     "idType" "app"."IdDocumentType",
ADD COLUMN     "latitude" DOUBLE PRECISION,
ADD COLUMN     "longitude" DOUBLE PRECISION,
ADD COLUMN     "nationality" TEXT,
ADD COLUMN     "nextOfKinAddress" TEXT,
ADD COLUMN     "nextOfKinIdNumber" TEXT,
ADD COLUMN     "nextOfKinName" TEXT,
ADD COLUMN     "nextOfKinPhone" TEXT,
ADD COLUMN     "nextOfKinRelation" TEXT,
ADD COLUMN     "payoutBankAccount" TEXT,
ADD COLUMN     "payoutBankName" TEXT,
ADD COLUMN     "payoutMsisdn" TEXT,
ADD COLUMN     "province" TEXT,
ADD COLUMN     "sector" TEXT,
ADD COLUMN     "status" "app"."WorkerStatus" NOT NULL DEFAULT 'DRAFT',
ADD COLUMN     "verificationChecks" JSONB,
ADD COLUMN     "verifiedAt" TIMESTAMP(3),
ADD COLUMN     "verifiedById" UUID,
ADD COLUMN     "village" TEXT,
DROP COLUMN "categories",
ADD COLUMN     "categories" TEXT[];

-- DropEnum
DROP TYPE "app"."ServiceCategory";

-- CreateTable
CREATE TABLE "app"."worker_documents" (
    "id" UUID NOT NULL,
    "workerId" UUID NOT NULL,
    "kind" "app"."WorkerDocumentKind" NOT NULL,
    "filename" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "uploadedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "worker_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."service_types" (
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "pricingGuide" TEXT,
    "feeType" "app"."ServiceFeeType" NOT NULL DEFAULT 'SERVICE',
    "visible" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_types_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "app"."platform_settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "serviceFeeRwf" INTEGER NOT NULL DEFAULT 1000,
    "matchFeeRwf" INTEGER NOT NULL DEFAULT 5000,
    "releaseAfterHours" INTEGER NOT NULL DEFAULT 24,
    "matchingPriority" TEXT[] DEFAULT ARRAY['AVAILABILITY', 'LANGUAGE', 'GENDER', 'RATING', 'DISTANCE']::TEXT[],
    "momoEnabled" BOOLEAN NOT NULL DEFAULT true,
    "cardEnabled" BOOLEAN NOT NULL DEFAULT false,
    "clientWalletEnabled" BOOLEAN NOT NULL DEFAULT false,
    "vouchersEnabled" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."audit_events" (
    "id" UUID NOT NULL,
    "actorId" UUID,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "data" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."staff_invitations" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "staffRole" "app"."StaffRole" NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "invitedById" UUID NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."ticket_notes" (
    "id" UUID NOT NULL,
    "ticketId" UUID NOT NULL,
    "authorId" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."ticket_messages" (
    "id" UUID NOT NULL,
    "ticketId" UUID NOT NULL,
    "authorId" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "worker_documents_workerId_kind_key" ON "app"."worker_documents"("workerId", "kind");

-- CreateIndex
CREATE INDEX "audit_events_entityType_entityId_createdAt_idx" ON "app"."audit_events"("entityType", "entityId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_events_createdAt_idx" ON "app"."audit_events"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "staff_invitations_tokenHash_key" ON "app"."staff_invitations"("tokenHash");

-- CreateIndex
CREATE INDEX "staff_invitations_email_idx" ON "app"."staff_invitations"("email");

-- CreateIndex
CREATE INDEX "ticket_notes_ticketId_createdAt_idx" ON "app"."ticket_notes"("ticketId", "createdAt");

-- CreateIndex
CREATE INDEX "ticket_messages_ticketId_createdAt_idx" ON "app"."ticket_messages"("ticketId", "createdAt");

-- CreateIndex
CREATE INDEX "workers_status_idx" ON "app"."workers"("status");

-- AddForeignKey
ALTER TABLE "app"."worker_documents" ADD CONSTRAINT "worker_documents_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "app"."workers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."service_requests" ADD CONSTRAINT "service_requests_category_fkey" FOREIGN KEY ("category") REFERENCES "app"."service_types"("key") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."support_tickets" ADD CONSTRAINT "support_tickets_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "app"."profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."ticket_notes" ADD CONSTRAINT "ticket_notes_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "app"."support_tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."ticket_notes" ADD CONSTRAINT "ticket_notes_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "app"."profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."ticket_messages" ADD CONSTRAINT "ticket_messages_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "app"."support_tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."ticket_messages" ADD CONSTRAINT "ticket_messages_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "app"."profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Guards Prisma can't express
ALTER TABLE "app"."platform_settings" ADD CONSTRAINT "platform_settings_single_row" CHECK ("id" = 1);
ALTER TABLE "app"."platform_settings" ADD CONSTRAINT "platform_settings_fees_valid"
  CHECK ("serviceFeeRwf" >= 0 AND "matchFeeRwf" >= 0 AND "releaseAfterHours" BETWEEN 0 AND 720);
ALTER TABLE "app"."worker_documents" ADD CONSTRAINT "worker_documents_size_cap" CHECK ("sizeBytes" > 0 AND "sizeBytes" <= 5242880);

-- Seed: default settings and the services clients could already request
INSERT INTO "app"."platform_settings" ("id", "updatedAt") VALUES (1, CURRENT_TIMESTAMP);
INSERT INTO "app"."service_types" ("key", "label", "feeType", "sortOrder", "updatedAt") VALUES
  ('CLEANING',   'Cleaning',               'SERVICE', 10, CURRENT_TIMESTAMP),
  ('COOKING',    'Cooking',                'SERVICE', 20, CURRENT_TIMESTAMP),
  ('ERRANDS',    'Errands & groceries',    'SERVICE', 30, CURRENT_TIMESTAMP),
  ('REPAIRS',    'Repairs',                'SERVICE', 40, CURRENT_TIMESTAMP),
  ('LAUNDRY',    'Laundry',                'SERVICE', 50, CURRENT_TIMESTAMP),
  ('DRIVER',     'Driver',                 'EITHER',  60, CURRENT_TIMESTAMP),
  ('HOUSE_HELP', 'House help (long-term)', 'MATCH',   70, CURRENT_TIMESTAMP),
  ('OTHER',      'Something else',         'SERVICE', 99, CURRENT_TIMESTAMP);

-- Existing admins become super admins
UPDATE "app"."profiles" SET "staffRole" = 'SUPER_ADMIN' WHERE "role" = 'ADMIN';
