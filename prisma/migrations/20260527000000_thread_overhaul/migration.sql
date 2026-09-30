-- Add titleSetByUser to AgentThread
ALTER TABLE "AgentThread"
  ADD COLUMN "titleSetByUser" BOOLEAN NOT NULL DEFAULT false;

-- Backfill: Itinerary.status should reflect ClientTrip.status when the trip is approved.
-- Previously the save step only flipped ClientTrip.status, leaving Itinerary at DRAFT.
UPDATE "Itinerary"
SET "status" = 'APPROVED_INTERNAL'
WHERE "tripId" IN (
  SELECT "id" FROM "ClientTrip" WHERE "status" = 'APPROVED_INTERNAL'
)
AND "status" = 'DRAFT';
