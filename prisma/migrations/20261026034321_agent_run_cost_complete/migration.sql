-- AlterTable
ALTER TABLE "AgentRun" ADD COLUMN     "costComplete" BOOLEAN NOT NULL DEFAULT true;

-- CreateIndex
CREATE INDEX "AgentRun_status_createdAt_idx" ON "AgentRun"("status", "createdAt");
