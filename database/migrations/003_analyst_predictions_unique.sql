-- 360SCOUT Migration 003 — UNIQUE(match_id, analyst_id) on analyst_predictions
-- Prevents inject_auto_consensus_predictions from creating duplicate rows
-- when the scheduler runs multiple cycles for the same match.

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'analyst_predictions_match_analyst_unique'
    ) THEN
        ALTER TABLE analyst_predictions
            ADD CONSTRAINT analyst_predictions_match_analyst_unique
            UNIQUE (match_id, analyst_id);
    END IF;
END
$$;
