-- Allow personal users to create AgentRun rows without an agency
ALTER TABLE "AgentRun" ALTER COLUMN "agencyId" DROP NOT NULL;
