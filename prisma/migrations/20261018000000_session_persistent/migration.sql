-- "Keep me signed in" choice per session. Existing rows count as remembered,
-- so nobody is signed out by the deploy.
ALTER TABLE "Session" ADD COLUMN "persistent" BOOLEAN NOT NULL DEFAULT true;
