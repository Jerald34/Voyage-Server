-- Place freshness gate: provider business status + agency place notes.
-- Additive only. Existing PlaceSnapshot rows keep NULL status/checked-at because
-- no historical verification actually happened; NULL means "unverified", never "open".

CREATE TYPE "PlaceBusinessStatus" AS ENUM ('OPERATIONAL', 'CLOSED_TEMPORARILY', 'CLOSED_PERMANENTLY');
CREATE TYPE "AgencyPlaceNoteStatus" AS ENUM ('AVOID', 'CLOSED', 'PREFERRED', 'NEUTRAL');

ALTER TABLE "PlaceSnapshot"
  ADD COLUMN "businessStatus" "PlaceBusinessStatus",
  ADD COLUMN "businessStatusCheckedAt" TIMESTAMP(3);

CREATE TABLE "AgencyPlaceNote" (
  "id" UUID NOT NULL,
  "agencyId" UUID NOT NULL,
  "provider" "PlaceProvider",
  "providerPlaceId" TEXT,
  "placeName" TEXT NOT NULL,
  "cityContext" TEXT,
  "status" "AgencyPlaceNoteStatus" NOT NULL DEFAULT 'NEUTRAL',
  "note" TEXT,
  "createdByUserId" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AgencyPlaceNote_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AgencyPlaceNote_provider_id_pair"
    CHECK (("provider" IS NULL) = ("providerPlaceId" IS NULL)),
  CONSTRAINT "AgencyPlaceNote_agencyId_fkey"
    FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "AgencyPlaceNote_createdByUserId_fkey"
    FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "AgencyPlaceNote_agencyId_provider_providerPlaceId_key"
  ON "AgencyPlaceNote"("agencyId", "provider", "providerPlaceId");
CREATE INDEX "AgencyPlaceNote_agencyId_cityContext_idx" ON "AgencyPlaceNote"("agencyId", "cityContext");
CREATE INDEX "AgencyPlaceNote_agencyId_placeName_idx" ON "AgencyPlaceNote"("agencyId", "placeName");
