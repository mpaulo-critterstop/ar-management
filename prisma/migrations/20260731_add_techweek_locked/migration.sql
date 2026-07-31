-- Protect imported/backfilled TechWeek rows from being overwritten by recompute crons.
ALTER TABLE "tech_weeks" ADD COLUMN IF NOT EXISTS "locked" BOOLEAN NOT NULL DEFAULT false;
