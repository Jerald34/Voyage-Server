-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AdminAuditAction" ADD VALUE 'USER_ENABLED';
ALTER TYPE "AdminAuditAction" ADD VALUE 'USER_SESSIONS_REVOKED';
ALTER TYPE "AdminAuditAction" ADD VALUE 'USER_DELETED';
ALTER TYPE "AdminAuditAction" ADD VALUE 'AGENCY_OWNERSHIP_TRANSFERRED';

-- AlterEnum
ALTER TYPE "UserStatus" ADD VALUE 'DELETED';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "deletedAt" TIMESTAMP(3);
