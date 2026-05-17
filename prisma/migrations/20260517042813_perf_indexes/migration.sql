-- CreateIndex
CREATE INDEX "AgentMessage_threadId_createdAt_idx" ON "AgentMessage"("threadId", "createdAt");

-- CreateIndex
CREATE INDEX "AgentRunEvent_threadId_type_createdAt_idx" ON "AgentRunEvent"("threadId", "type", "createdAt");

-- CreateIndex
CREATE INDEX "AgentThread_agencyId_updatedAt_idx" ON "AgentThread"("agencyId", "updatedAt");

-- CreateIndex
CREATE INDEX "ClientTrip_agencyId_createdAt_idx" ON "ClientTrip"("agencyId", "createdAt");

-- CreateIndex
CREATE INDEX "Itinerary_tripId_createdAt_idx" ON "Itinerary"("tripId", "createdAt");
