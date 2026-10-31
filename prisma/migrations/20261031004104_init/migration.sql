-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "app";

-- CreateEnum
CREATE TYPE "app"."UserRole" AS ENUM ('CLIENT', 'ADMIN');

-- CreateEnum
CREATE TYPE "app"."AccountType" AS ENUM ('INDIVIDUAL', 'COMPANY');

-- CreateEnum
CREATE TYPE "app"."Gender" AS ENUM ('FEMALE', 'MALE', 'UNDISCLOSED');

-- CreateEnum
CREATE TYPE "app"."Language" AS ENUM ('EN', 'FR', 'RW', 'SW');

-- CreateEnum
CREATE TYPE "app"."KycStatus" AS ENUM ('NOT_STARTED', 'PENDING', 'VERIFIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "app"."IdDocumentType" AS ENUM ('PASSPORT', 'NATIONAL_ID', 'DRIVING_LICENCE');

-- CreateEnum
CREATE TYPE "app"."ServiceCategory" AS ENUM ('CLEANING', 'COOKING', 'ERRANDS', 'REPAIRS', 'LAUNDRY', 'DRIVER', 'OTHER');

-- CreateEnum
CREATE TYPE "app"."ServiceRequestStatus" AS ENUM ('REQUESTED', 'PRICED', 'ADJUSTMENT_REQUESTED', 'PAID', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "app"."GenderPreference" AS ENUM ('ANY', 'FEMALE', 'MALE');

-- CreateEnum
CREATE TYPE "app"."PaymentStatus" AS ENUM ('PENDING', 'SUCCESSFUL', 'FAILED');

-- CreateEnum
CREATE TYPE "app"."PaymentProvider" AS ENUM ('MTN_MOMO', 'WALLET');

-- CreateEnum
CREATE TYPE "app"."WalletEntryType" AS ENUM ('REFUND_CREDIT', 'PAYMENT_DEBIT', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "app"."TicketStatus" AS ENUM ('OPEN', 'ACTIVE', 'CLOSED');

-- CreateTable
CREATE TABLE "app"."profiles" (
    "id" UUID NOT NULL,
    "role" "app"."UserRole" NOT NULL DEFAULT 'CLIENT',
    "accountType" "app"."AccountType" NOT NULL DEFAULT 'INDIVIDUAL',
    "fullName" TEXT NOT NULL,
    "companyName" TEXT,
    "avatarPath" TEXT,
    "gender" "app"."Gender",
    "birthDay" SMALLINT,
    "birthMonth" SMALLINT,
    "nationality" TEXT,
    "countryOfResidence" TEXT,
    "occupation" TEXT,
    "preferredLanguages" "app"."Language"[],
    "kycStatus" "app"."KycStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "pushEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."addresses" (
    "id" UUID NOT NULL,
    "profileId" UUID NOT NULL,
    "label" TEXT NOT NULL DEFAULT 'Home',
    "district" TEXT NOT NULL,
    "sector" TEXT NOT NULL,
    "street" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "addresses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."kyc_submissions" (
    "id" UUID NOT NULL,
    "profileId" UUID NOT NULL,
    "documentType" "app"."IdDocumentType" NOT NULL,
    "frontPath" TEXT NOT NULL,
    "backPath" TEXT,
    "status" "app"."KycStatus" NOT NULL DEFAULT 'PENDING',
    "rejectionReason" TEXT,
    "reviewedById" UUID,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kyc_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."saved_payment_methods" (
    "id" UUID NOT NULL,
    "profileId" UUID NOT NULL,
    "msisdn" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "saved_payment_methods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."workers" (
    "id" UUID NOT NULL,
    "fullName" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "gender" "app"."Gender" NOT NULL,
    "languages" "app"."Language"[],
    "categories" "app"."ServiceCategory"[],
    "photoPath" TEXT,
    "idVerified" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."service_requests" (
    "id" UUID NOT NULL,
    "number" SERIAL NOT NULL,
    "clientId" UUID NOT NULL,
    "category" "app"."ServiceCategory" NOT NULL,
    "description" TEXT NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "durationHours" DECIMAL(4,1) NOT NULL,
    "preferredGender" "app"."GenderPreference" NOT NULL DEFAULT 'ANY',
    "preferredLanguages" "app"."Language"[],
    "addressDistrict" TEXT NOT NULL,
    "addressSector" TEXT NOT NULL,
    "addressStreet" TEXT NOT NULL,
    "addressLatitude" DOUBLE PRECISION,
    "addressLongitude" DOUBLE PRECISION,
    "status" "app"."ServiceRequestStatus" NOT NULL DEFAULT 'REQUESTED',
    "workerFeeRwf" INTEGER,
    "serviceFeeRwf" INTEGER,
    "discountRwf" INTEGER NOT NULL DEFAULT 0,
    "quoteNote" TEXT,
    "pricedAt" TIMESTAMP(3),
    "adjustmentNote" TEXT,
    "voucherId" UUID,
    "assignedWorkerId" UUID,
    "cancellationReason" TEXT,
    "completedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."service_request_events" (
    "id" UUID NOT NULL,
    "serviceRequestId" UUID NOT NULL,
    "status" "app"."ServiceRequestStatus" NOT NULL,
    "actorId" UUID,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_request_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."payments" (
    "id" UUID NOT NULL,
    "receiptNumber" SERIAL NOT NULL,
    "serviceRequestId" UUID NOT NULL,
    "clientId" UUID NOT NULL,
    "provider" "app"."PaymentProvider" NOT NULL DEFAULT 'MTN_MOMO',
    "amountRwf" INTEGER NOT NULL,
    "status" "app"."PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "msisdn" TEXT,
    "providerReference" UUID,
    "providerTransactionId" TEXT,
    "failureReason" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."refunds" (
    "id" UUID NOT NULL,
    "paymentId" UUID NOT NULL,
    "amountRwf" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "issuedById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refunds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."wallet_entries" (
    "id" UUID NOT NULL,
    "profileId" UUID NOT NULL,
    "type" "app"."WalletEntryType" NOT NULL,
    "amountRwf" INTEGER NOT NULL,
    "refundId" UUID,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wallet_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."vouchers" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "discountRwf" INTEGER NOT NULL,
    "maxRedemptions" INTEGER,
    "redemptions" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vouchers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."reviews" (
    "id" UUID NOT NULL,
    "serviceRequestId" UUID NOT NULL,
    "clientId" UUID NOT NULL,
    "workerId" UUID NOT NULL,
    "rating" SMALLINT NOT NULL,
    "tags" TEXT[],
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."support_tickets" (
    "id" UUID NOT NULL,
    "number" SERIAL NOT NULL,
    "clientId" UUID NOT NULL,
    "serviceRequestId" UUID,
    "subject" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "attachmentPaths" TEXT[],
    "status" "app"."TicketStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "support_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "addresses_profileId_idx" ON "app"."addresses"("profileId");

-- CreateIndex
CREATE INDEX "kyc_submissions_profileId_idx" ON "app"."kyc_submissions"("profileId");

-- CreateIndex
CREATE INDEX "kyc_submissions_status_idx" ON "app"."kyc_submissions"("status");

-- CreateIndex
CREATE UNIQUE INDEX "saved_payment_methods_profileId_msisdn_key" ON "app"."saved_payment_methods"("profileId", "msisdn");

-- CreateIndex
CREATE UNIQUE INDEX "service_requests_number_key" ON "app"."service_requests"("number");

-- CreateIndex
CREATE INDEX "service_requests_clientId_status_idx" ON "app"."service_requests"("clientId", "status");

-- CreateIndex
CREATE INDEX "service_requests_status_scheduledAt_idx" ON "app"."service_requests"("status", "scheduledAt");

-- CreateIndex
CREATE INDEX "service_request_events_serviceRequestId_createdAt_idx" ON "app"."service_request_events"("serviceRequestId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "payments_receiptNumber_key" ON "app"."payments"("receiptNumber");

-- CreateIndex
CREATE UNIQUE INDEX "payments_providerReference_key" ON "app"."payments"("providerReference");

-- CreateIndex
CREATE INDEX "payments_clientId_createdAt_idx" ON "app"."payments"("clientId", "createdAt");

-- CreateIndex
CREATE INDEX "payments_serviceRequestId_idx" ON "app"."payments"("serviceRequestId");

-- CreateIndex
CREATE INDEX "refunds_paymentId_idx" ON "app"."refunds"("paymentId");

-- CreateIndex
CREATE UNIQUE INDEX "wallet_entries_refundId_key" ON "app"."wallet_entries"("refundId");

-- CreateIndex
CREATE INDEX "wallet_entries_profileId_createdAt_idx" ON "app"."wallet_entries"("profileId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "vouchers_code_key" ON "app"."vouchers"("code");

-- CreateIndex
CREATE UNIQUE INDEX "reviews_serviceRequestId_key" ON "app"."reviews"("serviceRequestId");

-- CreateIndex
CREATE INDEX "reviews_workerId_idx" ON "app"."reviews"("workerId");

-- CreateIndex
CREATE UNIQUE INDEX "support_tickets_number_key" ON "app"."support_tickets"("number");

-- CreateIndex
CREATE INDEX "support_tickets_clientId_createdAt_idx" ON "app"."support_tickets"("clientId", "createdAt");

-- CreateIndex
CREATE INDEX "support_tickets_status_idx" ON "app"."support_tickets"("status");

-- AddForeignKey
ALTER TABLE "app"."addresses" ADD CONSTRAINT "addresses_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "app"."profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."kyc_submissions" ADD CONSTRAINT "kyc_submissions_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "app"."profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."saved_payment_methods" ADD CONSTRAINT "saved_payment_methods_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "app"."profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."service_requests" ADD CONSTRAINT "service_requests_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "app"."profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."service_requests" ADD CONSTRAINT "service_requests_assignedWorkerId_fkey" FOREIGN KEY ("assignedWorkerId") REFERENCES "app"."workers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."service_requests" ADD CONSTRAINT "service_requests_voucherId_fkey" FOREIGN KEY ("voucherId") REFERENCES "app"."vouchers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."service_request_events" ADD CONSTRAINT "service_request_events_serviceRequestId_fkey" FOREIGN KEY ("serviceRequestId") REFERENCES "app"."service_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."payments" ADD CONSTRAINT "payments_serviceRequestId_fkey" FOREIGN KEY ("serviceRequestId") REFERENCES "app"."service_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."payments" ADD CONSTRAINT "payments_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "app"."profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."refunds" ADD CONSTRAINT "refunds_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "app"."payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."wallet_entries" ADD CONSTRAINT "wallet_entries_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "app"."profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."wallet_entries" ADD CONSTRAINT "wallet_entries_refundId_fkey" FOREIGN KEY ("refundId") REFERENCES "app"."refunds"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."reviews" ADD CONSTRAINT "reviews_serviceRequestId_fkey" FOREIGN KEY ("serviceRequestId") REFERENCES "app"."service_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."reviews" ADD CONSTRAINT "reviews_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "app"."profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."reviews" ADD CONSTRAINT "reviews_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "app"."workers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."support_tickets" ADD CONSTRAINT "support_tickets_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "app"."profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."support_tickets" ADD CONSTRAINT "support_tickets_serviceRequestId_fkey" FOREIGN KEY ("serviceRequestId") REFERENCES "app"."service_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Invariants Prisma cannot express
ALTER TABLE "app"."reviews" ADD CONSTRAINT "reviews_rating_range" CHECK ("rating" BETWEEN 1 AND 5);
ALTER TABLE "app"."profiles" ADD CONSTRAINT "profiles_birth_day_range" CHECK ("birthDay" IS NULL OR "birthDay" BETWEEN 1 AND 31);
ALTER TABLE "app"."profiles" ADD CONSTRAINT "profiles_birth_month_range" CHECK ("birthMonth" IS NULL OR "birthMonth" BETWEEN 1 AND 12);
ALTER TABLE "app"."service_requests" ADD CONSTRAINT "service_requests_fees_non_negative" CHECK (COALESCE("workerFeeRwf", 0) >= 0 AND COALESCE("serviceFeeRwf", 0) >= 0 AND "discountRwf" >= 0);
ALTER TABLE "app"."payments" ADD CONSTRAINT "payments_amount_non_negative" CHECK ("amountRwf" >= 0);
ALTER TABLE "app"."refunds" ADD CONSTRAINT "refunds_amount_positive" CHECK ("amountRwf" > 0);
