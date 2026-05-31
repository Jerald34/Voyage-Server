-- AlterTable
ALTER TABLE "ItineraryShare" ALTER COLUMN "tripId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "TripReview" ALTER COLUMN "id" DROP DEFAULT;
