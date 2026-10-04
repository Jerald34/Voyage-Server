-- Traveler accessibility needs captured before planning (nullable, additive).
ALTER TABLE "AgentThread" ADD COLUMN "travelerNeeds" JSONB;
