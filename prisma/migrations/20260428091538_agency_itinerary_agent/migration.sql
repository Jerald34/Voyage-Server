-- CreateEnum
CREATE TYPE "ClientTripStatus" AS ENUM ('DRAFT', 'IN_REVIEW', 'APPROVED_INTERNAL', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ItineraryStatus" AS ENUM ('DRAFT', 'NEEDS_REVIEW', 'APPROVED_INTERNAL');

-- CreateEnum
CREATE TYPE "ItineraryItemType" AS ENUM ('ACTIVITY', 'MEAL', 'TRANSFER', 'CHECK_IN', 'CHECK_OUT', 'FREE_TIME', 'NOTE');

-- CreateEnum
CREATE TYPE "PlaceProvider" AS ENUM ('GOOGLE_MAPS');

-- CreateEnum
CREATE TYPE "AgentThreadStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "AgentMessageRole" AS ENUM ('USER', 'ASSISTANT', 'SYSTEM_VISIBLE');

-- CreateEnum
CREATE TYPE "AgentRunStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AgentToolCallStatus" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "AgentTaskStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "AgentSourceType" AS ENUM ('WEB', 'MAP_PLACE', 'MAP_ROUTE');

-- CreateTable
CREATE TABLE "ClientTrip" (
    "id" UUID NOT NULL,
    "agencyId" UUID NOT NULL,
    "createdByUserId" UUID NOT NULL,
    "assignedOrganizerUserId" UUID,
    "title" TEXT NOT NULL,
    "destinationSummary" TEXT,
    "clientName" TEXT,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "travelerCount" INTEGER,
    "budgetLevel" TEXT,
    "status" "ClientTripStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientTrip_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Itinerary" (
    "id" UUID NOT NULL,
    "agencyId" UUID NOT NULL,
    "tripId" UUID NOT NULL,
    "createdByUserId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "status" "ItineraryStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Itinerary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItineraryDay" (
    "id" UUID NOT NULL,
    "itineraryId" UUID NOT NULL,
    "dayNumber" INTEGER NOT NULL,
    "date" TIMESTAMP(3),
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ItineraryDay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItineraryItem" (
    "id" UUID NOT NULL,
    "itineraryDayId" UUID NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "type" "ItineraryItemType" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "startTime" TEXT,
    "endTime" TEXT,
    "placeSnapshotId" UUID,
    "routeFromPrevious" JSONB,
    "staffNotes" TEXT,
    "clientNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ItineraryItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlaceSnapshot" (
    "id" UUID NOT NULL,
    "provider" "PlaceProvider" NOT NULL,
    "providerPlaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "formattedAddress" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "rating" DOUBLE PRECISION,
    "websiteUrl" TEXT,
    "phoneNumber" TEXT,
    "metadata" JSONB,
    "fetchedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlaceSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentThread" (
    "id" UUID NOT NULL,
    "agencyId" UUID NOT NULL,
    "tripId" UUID,
    "createdByUserId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "status" "AgentThreadStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentThread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentMessage" (
    "id" UUID NOT NULL,
    "threadId" UUID NOT NULL,
    "runId" UUID,
    "authorUserId" UUID,
    "role" "AgentMessageRole" NOT NULL,
    "content" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentRun" (
    "id" UUID NOT NULL,
    "threadId" UUID NOT NULL,
    "agencyId" UUID NOT NULL,
    "triggerMessageId" UUID,
    "status" "AgentRunStatus" NOT NULL DEFAULT 'QUEUED',
    "modelProvider" TEXT NOT NULL,
    "modelName" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentToolCall" (
    "id" UUID NOT NULL,
    "runId" UUID NOT NULL,
    "threadId" UUID NOT NULL,
    "toolName" TEXT NOT NULL,
    "status" "AgentToolCallStatus" NOT NULL,
    "input" JSONB,
    "outputSummary" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentToolCall_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentTask" (
    "id" UUID NOT NULL,
    "runId" UUID NOT NULL,
    "threadId" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "status" "AgentTaskStatus" NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentSource" (
    "id" UUID NOT NULL,
    "runId" UUID NOT NULL,
    "threadId" UUID NOT NULL,
    "sourceType" "AgentSourceType" NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT,
    "snippet" TEXT,
    "provider" TEXT NOT NULL,
    "retrievedAt" TIMESTAMP(3) NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentRunEvent" (
    "id" UUID NOT NULL,
    "runId" UUID NOT NULL,
    "threadId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentRunEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClientTrip_agencyId_idx" ON "ClientTrip"("agencyId");

-- CreateIndex
CREATE INDEX "ClientTrip_createdByUserId_idx" ON "ClientTrip"("createdByUserId");

-- CreateIndex
CREATE INDEX "ClientTrip_assignedOrganizerUserId_idx" ON "ClientTrip"("assignedOrganizerUserId");

-- CreateIndex
CREATE INDEX "ClientTrip_status_idx" ON "ClientTrip"("status");

-- CreateIndex
CREATE INDEX "Itinerary_agencyId_idx" ON "Itinerary"("agencyId");

-- CreateIndex
CREATE INDEX "Itinerary_tripId_idx" ON "Itinerary"("tripId");

-- CreateIndex
CREATE INDEX "Itinerary_createdByUserId_idx" ON "Itinerary"("createdByUserId");

-- CreateIndex
CREATE INDEX "Itinerary_status_idx" ON "Itinerary"("status");

-- CreateIndex
CREATE INDEX "ItineraryDay_itineraryId_idx" ON "ItineraryDay"("itineraryId");

-- CreateIndex
CREATE UNIQUE INDEX "ItineraryDay_itineraryId_dayNumber_key" ON "ItineraryDay"("itineraryId", "dayNumber");

-- CreateIndex
CREATE INDEX "ItineraryItem_itineraryDayId_idx" ON "ItineraryItem"("itineraryDayId");

-- CreateIndex
CREATE INDEX "ItineraryItem_placeSnapshotId_idx" ON "ItineraryItem"("placeSnapshotId");

-- CreateIndex
CREATE INDEX "ItineraryItem_sortOrder_idx" ON "ItineraryItem"("sortOrder");

-- CreateIndex
CREATE INDEX "PlaceSnapshot_providerPlaceId_idx" ON "PlaceSnapshot"("providerPlaceId");

-- CreateIndex
CREATE UNIQUE INDEX "PlaceSnapshot_provider_providerPlaceId_key" ON "PlaceSnapshot"("provider", "providerPlaceId");

-- CreateIndex
CREATE INDEX "AgentThread_agencyId_idx" ON "AgentThread"("agencyId");

-- CreateIndex
CREATE INDEX "AgentThread_tripId_idx" ON "AgentThread"("tripId");

-- CreateIndex
CREATE INDEX "AgentThread_createdByUserId_idx" ON "AgentThread"("createdByUserId");

-- CreateIndex
CREATE INDEX "AgentThread_status_idx" ON "AgentThread"("status");

-- CreateIndex
CREATE INDEX "AgentMessage_threadId_idx" ON "AgentMessage"("threadId");

-- CreateIndex
CREATE INDEX "AgentMessage_runId_idx" ON "AgentMessage"("runId");

-- CreateIndex
CREATE INDEX "AgentMessage_authorUserId_idx" ON "AgentMessage"("authorUserId");

-- CreateIndex
CREATE INDEX "AgentMessage_role_idx" ON "AgentMessage"("role");

-- CreateIndex
CREATE INDEX "AgentRun_threadId_idx" ON "AgentRun"("threadId");

-- CreateIndex
CREATE INDEX "AgentRun_agencyId_idx" ON "AgentRun"("agencyId");

-- CreateIndex
CREATE INDEX "AgentRun_triggerMessageId_idx" ON "AgentRun"("triggerMessageId");

-- CreateIndex
CREATE INDEX "AgentRun_status_idx" ON "AgentRun"("status");

-- CreateIndex
CREATE INDEX "AgentToolCall_runId_idx" ON "AgentToolCall"("runId");

-- CreateIndex
CREATE INDEX "AgentToolCall_threadId_idx" ON "AgentToolCall"("threadId");

-- CreateIndex
CREATE INDEX "AgentToolCall_toolName_idx" ON "AgentToolCall"("toolName");

-- CreateIndex
CREATE INDEX "AgentToolCall_status_idx" ON "AgentToolCall"("status");

-- CreateIndex
CREATE INDEX "AgentTask_runId_idx" ON "AgentTask"("runId");

-- CreateIndex
CREATE INDEX "AgentTask_threadId_idx" ON "AgentTask"("threadId");

-- CreateIndex
CREATE INDEX "AgentTask_status_idx" ON "AgentTask"("status");

-- CreateIndex
CREATE INDEX "AgentSource_runId_idx" ON "AgentSource"("runId");

-- CreateIndex
CREATE INDEX "AgentSource_threadId_idx" ON "AgentSource"("threadId");

-- CreateIndex
CREATE INDEX "AgentSource_sourceType_idx" ON "AgentSource"("sourceType");

-- CreateIndex
CREATE INDEX "AgentRunEvent_runId_createdAt_idx" ON "AgentRunEvent"("runId", "createdAt");

-- CreateIndex
CREATE INDEX "AgentRunEvent_threadId_idx" ON "AgentRunEvent"("threadId");

-- CreateIndex
CREATE INDEX "AgentRunEvent_type_idx" ON "AgentRunEvent"("type");

-- AddForeignKey
ALTER TABLE "ClientTrip" ADD CONSTRAINT "ClientTrip_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientTrip" ADD CONSTRAINT "ClientTrip_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientTrip" ADD CONSTRAINT "ClientTrip_assignedOrganizerUserId_fkey" FOREIGN KEY ("assignedOrganizerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Itinerary" ADD CONSTRAINT "Itinerary_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Itinerary" ADD CONSTRAINT "Itinerary_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "ClientTrip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Itinerary" ADD CONSTRAINT "Itinerary_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItineraryDay" ADD CONSTRAINT "ItineraryDay_itineraryId_fkey" FOREIGN KEY ("itineraryId") REFERENCES "Itinerary"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItineraryItem" ADD CONSTRAINT "ItineraryItem_itineraryDayId_fkey" FOREIGN KEY ("itineraryDayId") REFERENCES "ItineraryDay"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItineraryItem" ADD CONSTRAINT "ItineraryItem_placeSnapshotId_fkey" FOREIGN KEY ("placeSnapshotId") REFERENCES "PlaceSnapshot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentThread" ADD CONSTRAINT "AgentThread_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentThread" ADD CONSTRAINT "AgentThread_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "ClientTrip"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentThread" ADD CONSTRAINT "AgentThread_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentMessage" ADD CONSTRAINT "AgentMessage_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "AgentThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentMessage" ADD CONSTRAINT "AgentMessage_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AgentRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentMessage" ADD CONSTRAINT "AgentMessage_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "AgentThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentToolCall" ADD CONSTRAINT "AgentToolCall_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AgentRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentToolCall" ADD CONSTRAINT "AgentToolCall_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "AgentThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentTask" ADD CONSTRAINT "AgentTask_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AgentRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentTask" ADD CONSTRAINT "AgentTask_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "AgentThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentSource" ADD CONSTRAINT "AgentSource_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AgentRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentSource" ADD CONSTRAINT "AgentSource_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "AgentThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRunEvent" ADD CONSTRAINT "AgentRunEvent_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AgentRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRunEvent" ADD CONSTRAINT "AgentRunEvent_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "AgentThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;
