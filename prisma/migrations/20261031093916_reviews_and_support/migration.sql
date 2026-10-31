/*
  Warnings:

  - The `tags` column on the `reviews` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - You are about to drop the column `attachmentPaths` on the `support_tickets` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "app"."ReviewTag" AS ENUM ('ON_TIME', 'THOROUGH', 'FRIENDLY', 'RESPECTFUL', 'COMMUNICATED_WELL');

-- AlterTable
ALTER TABLE "app"."reviews" DROP COLUMN "tags",
ADD COLUMN     "tags" "app"."ReviewTag"[];

-- AlterTable
ALTER TABLE "app"."support_tickets" DROP COLUMN "attachmentPaths",
ADD COLUMN     "closedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "app"."ticket_attachments" (
    "id" UUID NOT NULL,
    "ticketId" UUID NOT NULL,
    "filename" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ticket_attachments_ticketId_idx" ON "app"."ticket_attachments"("ticketId");

-- AddForeignKey
ALTER TABLE "app"."ticket_attachments" ADD CONSTRAINT "ticket_attachments_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "app"."support_tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Attachments are capped in the app too; this is the backstop
ALTER TABLE "app"."ticket_attachments" ADD CONSTRAINT "ticket_attachments_size_cap" CHECK ("sizeBytes" > 0 AND "sizeBytes" <= 5242880);
