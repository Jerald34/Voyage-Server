-- CreateEnum
CREATE TYPE "CommentStatus" AS ENUM ('PENDING', 'SEEN', 'ADDRESSED');

-- CreateTable
CREATE TABLE "ItineraryShare" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "itineraryId" UUID NOT NULL,
    "tripId" UUID NOT NULL,
    "agencyId" UUID NOT NULL,
    "clientName" TEXT,
    "clientEmail" TEXT,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "lastViewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ItineraryShare_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItineraryComment" (
    "id" TEXT NOT NULL,
    "shareId" TEXT NOT NULL,
    "authorName" TEXT NOT NULL,
    "authorEmail" TEXT,
    "content" TEXT NOT NULL,
    "dayNumber" INTEGER,
    "itemId" UUID,
    "status" "CommentStatus" NOT NULL DEFAULT 'PENDING',
    "agencyReply" TEXT,
    "agencyRepliedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ItineraryComment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ItineraryShare_token_key" ON "ItineraryShare"("token");

-- CreateIndex
CREATE INDEX "ItineraryShare_itineraryId_idx" ON "ItineraryShare"("itineraryId");

-- CreateIndex
CREATE INDEX "ItineraryShare_tripId_idx" ON "ItineraryShare"("tripId");

-- CreateIndex
CREATE INDEX "ItineraryShare_agencyId_idx" ON "ItineraryShare"("agencyId");

-- CreateIndex
CREATE INDEX "ItineraryShare_token_idx" ON "ItineraryShare"("token");

-- CreateIndex
CREATE INDEX "ItineraryComment_shareId_idx" ON "ItineraryComment"("shareId");

-- CreateIndex
CREATE INDEX "ItineraryComment_status_idx" ON "ItineraryComment"("status");

-- AddForeignKey
ALTER TABLE "ItineraryShare" ADD CONSTRAINT "ItineraryShare_itineraryId_fkey" FOREIGN KEY ("itineraryId") REFERENCES "Itinerary"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItineraryShare" ADD CONSTRAINT "ItineraryShare_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "ClientTrip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItineraryShare" ADD CONSTRAINT "ItineraryShare_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItineraryComment" ADD CONSTRAINT "ItineraryComment_shareId_fkey" FOREIGN KEY ("shareId") REFERENCES "ItineraryShare"("id") ON DELETE CASCADE ON UPDATE CASCADE;
