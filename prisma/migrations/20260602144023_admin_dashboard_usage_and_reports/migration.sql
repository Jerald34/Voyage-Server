-- CreateEnum
CREATE TYPE "ProblemCategory" AS ENUM ('BUG', 'BILLING', 'FEATURE', 'OTHER');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('NEW', 'IN_PROGRESS', 'RESOLVED', 'WONT_FIX');

-- AlterTable
ALTER TABLE "AgentRun" ADD COLUMN     "cachedTokens" INTEGER,
ADD COLUMN     "costUsd" DECIMAL(12,6),
ADD COLUMN     "outputTokens" INTEGER,
ADD COLUMN     "promptTokens" INTEGER,
ADD COLUMN     "thoughtsTokens" INTEGER,
ADD COLUMN     "totalTokens" INTEGER,
ADD COLUMN     "usageDetail" JSONB,
ADD COLUMN     "usageUserId" UUID;

-- CreateTable
CREATE TABLE "ProblemReport" (
    "id" UUID NOT NULL,
    "reporterUserId" UUID NOT NULL,
    "agencyId" UUID,
    "category" "ProblemCategory" NOT NULL DEFAULT 'OTHER',
    "subject" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "status" "ReportStatus" NOT NULL DEFAULT 'NEW',
    "adminNotes" TEXT,
    "githubIssueUrl" TEXT,
    "githubIssueNumber" INTEGER,
    "resolvedByAdminUserId" UUID,
    "resolvedAt" TIMESTAMP(3),
    "appContext" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProblemReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProblemReport_status_idx" ON "ProblemReport"("status");

-- CreateIndex
CREATE INDEX "ProblemReport_reporterUserId_idx" ON "ProblemReport"("reporterUserId");

-- CreateIndex
CREATE INDEX "ProblemReport_createdAt_idx" ON "ProblemReport"("createdAt");

-- CreateIndex
CREATE INDEX "AgentRun_usageUserId_createdAt_idx" ON "AgentRun"("usageUserId", "createdAt");

-- CreateIndex
CREATE INDEX "AgentRun_agencyId_createdAt_idx" ON "AgentRun"("agencyId", "createdAt");

-- AddForeignKey
ALTER TABLE "ProblemReport" ADD CONSTRAINT "ProblemReport_reporterUserId_fkey" FOREIGN KEY ("reporterUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProblemReport" ADD CONSTRAINT "ProblemReport_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProblemReport" ADD CONSTRAINT "ProblemReport_resolvedByAdminUserId_fkey" FOREIGN KEY ("resolvedByAdminUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
