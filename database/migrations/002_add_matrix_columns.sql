-- 360SCOUT Migration 002 — Matrix columns + analyst name uniqueness
-- Safe to run multiple times (IF NOT EXISTS / ADD CONSTRAINT IF NOT EXISTS)

-- Pre-match snapshot and halftime recalculation matrices
ALTER TABLE match_predictions
    ADD COLUMN IF NOT EXISTS pre_match_matrix  JSONB DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS halftime_matrix   JSONB DEFAULT NULL;

-- Required for inject_auto_consensus_predictions UPSERT (ON CONFLICT (name))
ALTER TABLE analysts
    ADD CONSTRAINT IF NOT EXISTS analysts_name_unique UNIQUE (name);
