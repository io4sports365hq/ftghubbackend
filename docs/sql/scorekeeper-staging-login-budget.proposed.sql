-- Dedicated staging only; no Production migration authorization.
CREATE TABLE public.scorekeeper_staging_login_budget (
  slot boolean PRIMARY KEY DEFAULT true CHECK (slot),
  window_start_ms bigint NOT NULL CHECK (window_start_ms >= 0),
  used integer NOT NULL CHECK (used > 0)
);
GRANT SELECT, INSERT, UPDATE ON public.scorekeeper_staging_login_budget TO scorekeeper_auth_access;
