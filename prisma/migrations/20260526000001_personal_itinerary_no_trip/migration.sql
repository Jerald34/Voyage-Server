-- Allow Itinerary rows without a trip (personal itineraries have no ClientTrip)
ALTER TABLE "Itinerary" ALTER COLUMN "tripId" DROP NOT NULL;
