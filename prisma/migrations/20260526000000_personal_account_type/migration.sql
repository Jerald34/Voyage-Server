-- 1. Enum
CREATE TYPE "UserAccountType" AS ENUM ('PENDING', 'PERSONAL', 'AGENCY_USER');

-- 2. Column with default so the column is NOT NULL from insert
ALTER TABLE "User" ADD COLUMN "accountType" "UserAccountType" NOT NULL DEFAULT 'PENDING';

-- 3. Backfill: users with any membership become AGENCY_USER; everyone else becomes PERSONAL.
UPDATE "User"
SET "accountType" = 'AGENCY_USER'
WHERE id IN (SELECT DISTINCT "userId" FROM "AgencyMembership");

UPDATE "User"
SET "accountType" = 'PERSONAL'
WHERE "accountType" = 'PENDING';

-- 4. Make agencyId nullable on three tables
ALTER TABLE "Itinerary" ALTER COLUMN "agencyId" DROP NOT NULL;
ALTER TABLE "AgentThread" ALTER COLUMN "agencyId" DROP NOT NULL;
ALTER TABLE "ItineraryShare" ALTER COLUMN "agencyId" DROP NOT NULL;
