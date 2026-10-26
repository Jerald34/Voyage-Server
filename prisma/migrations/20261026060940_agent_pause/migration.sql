-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AdminAuditAction" ADD VALUE 'AGENT_PAUSED';
ALTER TYPE "AdminAuditAction" ADD VALUE 'AGENT_RESUMED';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "agentPauseReason" TEXT,
ADD COLUMN     "agentPausedAt" TIMESTAMP(3),
ADD COLUMN     "agentPausedByUserId" UUID,
ADD COLUMN     "agentPausedUntil" TIMESTAMP(3);
