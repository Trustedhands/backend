-- CreateEnum
CREATE TYPE "app"."PlacementArrangement" AS ENUM ('LIVE_IN', 'LIVE_OUT');

-- AlterTable
ALTER TABLE "app"."service_requests" ADD COLUMN     "placementArrangement" "app"."PlacementArrangement",
ADD COLUMN     "placementDaysPerWeek" SMALLINT,
ADD COLUMN     "placementSalaryRwf" INTEGER,
ALTER COLUMN "durationHours" DROP NOT NULL;


-- Each kind of request carries its own required details
ALTER TABLE "app"."service_requests" ADD CONSTRAINT "service_requests_kind_details" CHECK (
  ("kind" = 'VISIT' AND "durationHours" IS NOT NULL)
  OR ("kind" = 'PLACEMENT' AND "placementArrangement" IS NOT NULL AND "placementDaysPerWeek" BETWEEN 1 AND 7)
);
ALTER TABLE "app"."service_requests" ADD CONSTRAINT "service_requests_salary_positive" CHECK ("placementSalaryRwf" IS NULL OR "placementSalaryRwf" > 0);
