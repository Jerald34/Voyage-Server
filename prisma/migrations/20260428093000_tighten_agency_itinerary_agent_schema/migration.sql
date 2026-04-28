-- DropForeignKey
ALTER TABLE "Itinerary" DROP CONSTRAINT "Itinerary_tripId_fkey";

-- DropForeignKey
ALTER TABLE "AgentThread" DROP CONSTRAINT "AgentThread_tripId_fkey";

-- DropForeignKey
ALTER TABLE "AgentRun" DROP CONSTRAINT "AgentRun_threadId_fkey";

-- CreateIndex
CREATE UNIQUE INDEX "ClientTrip_id_agencyId_key" ON "ClientTrip"("id", "agencyId");

-- CreateIndex
CREATE UNIQUE INDEX "ItineraryItem_itineraryDayId_sortOrder_key" ON "ItineraryItem"("itineraryDayId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "AgentThread_id_agencyId_key" ON "AgentThread"("id", "agencyId");

-- CreateIndex
CREATE UNIQUE INDEX "AgentTask_runId_sortOrder_key" ON "AgentTask"("runId", "sortOrder");

-- AddForeignKey
ALTER TABLE "Itinerary" ADD CONSTRAINT "Itinerary_tripId_agencyId_fkey" FOREIGN KEY ("tripId", "agencyId") REFERENCES "ClientTrip"("id", "agencyId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentThread" ADD CONSTRAINT "AgentThread_tripId_agencyId_fkey" FOREIGN KEY ("tripId", "agencyId") REFERENCES "ClientTrip"("id", "agencyId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_threadId_agencyId_fkey" FOREIGN KEY ("threadId", "agencyId") REFERENCES "AgentThread"("id", "agencyId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_triggerMessageId_fkey" FOREIGN KEY ("triggerMessageId") REFERENCES "AgentMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
