-- REVIEW ONLY. The current Scorekeeper captures opponent score, not opponent fouls.
-- Allow explicit NULL for unknown observations. Preserve every existing value and
-- the current default for other clients. Review all public consumers before release.
ALTER TABLE ftg_games ALTER COLUMN away_fouls DROP NOT NULL;
