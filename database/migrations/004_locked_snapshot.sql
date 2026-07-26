-- 360SCOUT Migration 004 — Locked prediction snapshot
-- Freezes a match's recommendation/final probabilities/Monte Carlo/value bets
-- the first time it's observed live or finished, so it never silently changes
-- again and every page (and grading) reads the same frozen value.
-- Safe to run multiple times (ADD COLUMN IF NOT EXISTS).

ALTER TABLE match_predictions
    ADD COLUMN IF NOT EXISTS locked_snapshot JSONB DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS locked_odds     JSONB DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS locked_at       TIMESTAMPTZ DEFAULT NULL;
