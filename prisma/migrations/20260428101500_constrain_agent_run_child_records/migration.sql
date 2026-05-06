-- DropForeignKey
ALTER TABLE "AgentMessage" DROP CONSTRAINT "AgentMessage_runId_fkey";

-- DropForeignKey
ALTER TABLE "AgentRun" DROP CONSTRAINT "AgentRun_triggerMessageId_fkey";

-- DropForeignKey
ALTER TABLE "AgentToolCall" DROP CONSTRAINT "AgentToolCall_runId_fkey";

-- DropForeignKey
ALTER TABLE "AgentTask" DROP CONSTRAINT "AgentTask_runId_fkey";

-- DropForeignKey
ALTER TABLE "AgentSource" DROP CONSTRAINT "AgentSource_runId_fkey";

-- DropForeignKey
ALTER TABLE "AgentRunEvent" DROP CONSTRAINT "AgentRunEvent_runId_fkey";

-- CreateIndex
CREATE UNIQUE INDEX "AgentMessage_id_threadId_key" ON "AgentMessage"("id", "threadId");

-- CreateIndex
CREATE UNIQUE INDEX "AgentRun_id_threadId_key" ON "AgentRun"("id", "threadId");

-- AddForeignKey
ALTER TABLE "AgentMessage" ADD CONSTRAINT "AgentMessage_runId_threadId_fkey" FOREIGN KEY ("runId", "threadId") REFERENCES "AgentRun"("id", "threadId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_triggerMessageId_threadId_fkey" FOREIGN KEY ("triggerMessageId", "threadId") REFERENCES "AgentMessage"("id", "threadId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentToolCall" ADD CONSTRAINT "AgentToolCall_runId_threadId_fkey" FOREIGN KEY ("runId", "threadId") REFERENCES "AgentRun"("id", "threadId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentTask" ADD CONSTRAINT "AgentTask_runId_threadId_fkey" FOREIGN KEY ("runId", "threadId") REFERENCES "AgentRun"("id", "threadId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentSource" ADD CONSTRAINT "AgentSource_runId_threadId_fkey" FOREIGN KEY ("runId", "threadId") REFERENCES "AgentRun"("id", "threadId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRunEvent" ADD CONSTRAINT "AgentRunEvent_runId_threadId_fkey" FOREIGN KEY ("runId", "threadId") REFERENCES "AgentRun"("id", "threadId") ON DELETE CASCADE ON UPDATE CASCADE;
