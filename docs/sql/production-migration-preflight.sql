-- REVIEW ONLY. Execute only inside the separately authorized migration transaction.
-- External controller must attest FTG Hub project rough-unit-04966087, branch
-- br-super-base-axndwya2, database neondb and actual Hub connection first.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
SET LOCAL search_path = public, pg_catalog;
DO $preflight$
BEGIN
 IF (SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND ((table_name='ftg_events' AND column_name='id') OR (table_name='ftg_games' AND column_name IN ('id','event_id')) OR (table_name='ftg_game_players' AND column_name IN ('id','game_id'))) AND data_type='uuid' AND is_nullable='NO') <> 5 THEN
  RAISE EXCEPTION 'Unexpected Hub identifier schema';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='ftg_games' AND column_name='away_fouls' AND data_type='integer' AND is_nullable='NO') OR
    NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='ftg_games' AND column_name='game_time' AND data_type='time without time zone') THEN
  RAISE EXCEPTION 'Unexpected Hub game schema';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname='public' AND t.relname='ftg_games' AND c.contype='u' AND pg_get_constraintdef(c.oid)='UNIQUE (event_id, game_number)') THEN
  RAISE EXCEPTION 'Missing game slot uniqueness';
 END IF;
 IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('scorekeeper_publish_versions','scorekeeper_publish_receipts','scorekeeper_operators','scorekeeper_operator_sessions','scorekeeper_operator_assignments','scorekeeper_operator_rate_windows','scorekeeper_oidc_flows','scorekeeper_login_budget')) OR EXISTS (SELECT 1 FROM pg_roles WHERE rolname IN ('scorekeeper_auth_access','scorekeeper_publish_access')) THEN
  RAISE EXCEPTION 'Existing Scorekeeper objects require manual review';
 END IF;
END $preflight$;
