-- REVIEW ONLY. For the isolated Scorekeeper schema; not a Production migration.
-- Run as schema owner. Login roles should be separately provisioned with no
-- administrative memberships, and granted only one of these NOLOGIN groups.
CREATE ROLE scorekeeper_auth_access NOLOGIN;
CREATE ROLE scorekeeper_publish_access NOLOGIN;

-- PostgreSQL row locks require UPDATE on at least one column. Give the
-- runtime a non-null, constant guard rather than authority to edit identity,
-- assignment, or event records. The CHECK disallows changing its value.
ALTER TABLE public.scorekeeper_operators ADD COLUMN lock_guard boolean NOT NULL DEFAULT true CHECK (lock_guard);
ALTER TABLE public.scorekeeper_operator_assignments ADD COLUMN lock_guard boolean NOT NULL DEFAULT true CHECK (lock_guard);
ALTER TABLE public.ftg_events ADD COLUMN lock_guard boolean NOT NULL DEFAULT true CHECK (lock_guard);
ALTER TABLE public.scorekeeper_operator_sessions ADD COLUMN lock_guard boolean NOT NULL DEFAULT true CHECK (lock_guard);

GRANT USAGE ON SCHEMA public TO scorekeeper_auth_access, scorekeeper_publish_access;
GRANT SELECT ON public.scorekeeper_operators, public.scorekeeper_operator_assignments, public.scorekeeper_operator_sessions TO scorekeeper_auth_access, scorekeeper_publish_access;
GRANT UPDATE (lock_guard) ON public.scorekeeper_operators TO scorekeeper_auth_access, scorekeeper_publish_access;
GRANT UPDATE (lock_guard) ON public.scorekeeper_operator_assignments, public.scorekeeper_operator_sessions, public.ftg_events TO scorekeeper_publish_access;
GRANT INSERT (token_hash,operator_id,expires_at,idle_expires_at), UPDATE (idle_expires_at,revoked_at) ON public.scorekeeper_operator_sessions TO scorekeeper_auth_access;
GRANT SELECT, INSERT, DELETE ON public.scorekeeper_oidc_flows TO scorekeeper_auth_access;
GRANT SELECT, INSERT, UPDATE ON public.scorekeeper_operator_rate_windows TO scorekeeper_auth_access, scorekeeper_publish_access;
GRANT SELECT ON public.ftg_events, public.ftg_games, public.ftg_game_players, public.scorekeeper_publish_versions, public.scorekeeper_publish_receipts TO scorekeeper_publish_access;
GRANT INSERT, UPDATE ON public.ftg_games TO scorekeeper_publish_access;
GRANT INSERT, DELETE ON public.ftg_game_players TO scorekeeper_publish_access;
GRANT INSERT, UPDATE (revision,payload_digest,updated_at) ON public.scorekeeper_publish_versions TO scorekeeper_publish_access;
GRANT INSERT ON public.scorekeeper_publish_receipts TO scorekeeper_publish_access;
GRANT USAGE ON SEQUENCE public.ftg_games_id_seq TO scorekeeper_publish_access;
