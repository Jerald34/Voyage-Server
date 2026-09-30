-- Migration: agency_dashboard_ratings
-- Date: 2026-05-26
-- Adds proposal-rating fields to ItineraryShare, and new TripReview + TripReviewEmailLog models.

-- 1. Extend ItineraryShare with proposal rating fields
ALTER TABLE "ItineraryShare"
  ADD COLUMN "proposalRating" INTEGER,
  ADD COLUMN "proposalRatingComment" TEXT,
  ADD COLUMN "proposalRatedAt" TIMESTAMP(3);

CREATE INDEX "ItineraryShare_proposalRating_idx" ON "ItineraryShare"("proposalRating");

-- 2. Create TripReview model
CREATE TABLE "TripReview" (
  "id"                   UUID NOT NULL DEFAULT gen_random_uuid(),
  "tripId"               UUID NOT NULL,
  "agencyId"             UUID NOT NULL,
  "rating"               INTEGER NOT NULL,
  "npsScore"             INTEGER,
  "reviewText"           TEXT,
  "respondentName"       TEXT,
  "respondentEmail"      TEXT,
  "consentToTestimonial" BOOLEAN NOT NULL DEFAULT false,
  "submittedAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "emailSentAt"          TIMESTAMP(3),
  "createdAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "TripReview_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "TripReview"
  ADD CONSTRAINT "TripReview_tripId_fkey"
    FOREIGN KEY ("tripId") REFERENCES "ClientTrip"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "TripReview_agencyId_fkey"
    FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "TripReview_agencyId_idx" ON "TripReview"("agencyId");
CREATE INDEX "TripReview_agencyId_submittedAt_idx" ON "TripReview"("agencyId", "submittedAt");
CREATE INDEX "TripReview_rating_idx" ON "TripReview"("rating");

-- 3. Create TripReviewEmailLog model (one row per trip, keyed by tripId)
CREATE TABLE "TripReviewEmailLog" (
  "tripId" UUID NOT NULL,
  "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "TripReviewEmailLog_pkey" PRIMARY KEY ("tripId")
);

ALTER TABLE "TripReviewEmailLog"
  ADD CONSTRAINT "TripReviewEmailLog_tripId_fkey"
    FOREIGN KEY ("tripId") REFERENCES "ClientTrip"("id") ON DELETE CASCADE ON UPDATE CASCADE;
