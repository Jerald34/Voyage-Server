-- Allow runId to be NULL so tasks can outlive a single run
ALTER TABLE "AgentTask" ALTER COLUMN "runId" DROP NOT NULL;

-- Drop the run-scoped uniqueness constraint
DROP INDEX "AgentTask_runId_sortOrder_key";

-- Replace with thread-scoped uniqueness constraint
CREATE UNIQUE INDEX "AgentTask_threadId_sortOrder_key"
  ON "AgentTask"("threadId", "sortOrder");
