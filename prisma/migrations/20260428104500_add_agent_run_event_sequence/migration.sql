ALTER TABLE "AgentRunEvent" ADD COLUMN "sequence" INTEGER NOT NULL DEFAULT 0;

WITH ordered_events AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "runId"
      ORDER BY "createdAt" ASC, "id" ASC
    ) AS "sequence"
  FROM "AgentRunEvent"
)
UPDATE "AgentRunEvent"
SET "sequence" = ordered_events."sequence"
FROM ordered_events
WHERE "AgentRunEvent"."id" = ordered_events."id";

CREATE INDEX "AgentRunEvent_runId_sequence_idx" ON "AgentRunEvent"("runId", "sequence");
