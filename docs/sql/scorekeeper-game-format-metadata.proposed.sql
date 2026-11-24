-- REVIEW ONLY. Never apply to Production without actual schema review and approval.
-- Preserve quarter/challenge values already captured by the Scorekeeper UI.
-- Nullable for preexisting legacy rows; do not fabricate historical values.
ALTER TABLE ftg_games
 ADD COLUMN home_quarter_points numeric(3,1) CHECK(home_quarter_points>=0 AND home_quarter_points<=4 AND mod(home_quarter_points*2,1)=0),
 ADD COLUMN away_quarter_points numeric(3,1) CHECK(away_quarter_points>=0 AND away_quarter_points<=4 AND mod(away_quarter_points*2,1)=0),
 ADD COLUMN target_score integer CHECK(target_score>0);
