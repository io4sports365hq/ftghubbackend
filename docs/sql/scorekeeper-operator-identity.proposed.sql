-- Proposed identity storage for review only; never apply to Production.
-- Session tokens are random opaque values; store only SHA-256 token hashes.
CREATE TABLE scorekeeper_operators (
 operator_id text PRIMARY KEY,
 issuer text NOT NULL,
 subject text NOT NULL,
 active boolean NOT NULL DEFAULT false,
 revoked_at timestamptz,
 UNIQUE(issuer,subject)
);
CREATE TABLE scorekeeper_operator_sessions (
 token_hash char(64) PRIMARY KEY CHECK(token_hash ~ '^[a-f0-9]{64}$'),
 operator_id text NOT NULL,
 expires_at timestamptz NOT NULL,
 idle_expires_at timestamptz NOT NULL CHECK(idle_expires_at <= expires_at),
 revoked_at timestamptz
);
CREATE TABLE scorekeeper_operator_assignments (
 operator_id text NOT NULL,
 event_slug text NOT NULL,
 game_number text NOT NULL,
 capture_id text NOT NULL,
 valid_from timestamptz NOT NULL DEFAULT '-infinity',
 expires_at timestamptz NOT NULL,
 revoked_at timestamptz,
 active boolean NOT NULL DEFAULT false,
 -- Review-only authoritative scope; legacy synthetic fixtures have none.
 scope jsonb CHECK(scope IS NULL OR jsonb_typeof(scope)='object'),
 CHECK(expires_at>valid_from),
 PRIMARY KEY(operator_id,event_slug,game_number,capture_id)
);

-- One bounded counter row per operator and operation; no unbounded window history.
CREATE TABLE scorekeeper_operator_rate_windows (
 operator_id text NOT NULL,
 operation text NOT NULL CHECK(operation IN ('scorer_context','scorer_publish','scorer_receipt','hub_context','hub_publish','hub_receipt')),
 window_start_ms bigint NOT NULL CHECK(window_start_ms>=0),
 used integer NOT NULL CHECK(used>0),
 PRIMARY KEY(operator_id,operation)
);

-- Short-lived one-time login flows. No provider tokens, raw cookie/state, email
-- or roles are persisted. Nonce and PKCE verifier are transient server secrets.
CREATE TABLE scorekeeper_oidc_flows (
 flow_hash char(64) PRIMARY KEY CHECK(flow_hash ~ '^[a-f0-9]{64}$'),
 state_hash char(64) UNIQUE NOT NULL CHECK(state_hash ~ '^[a-f0-9]{64}$'),
 nonce text NOT NULL CHECK(nonce ~ '^[A-Za-z0-9_-]{43}$'),
 verifier text NOT NULL CHECK(verifier ~ '^[A-Za-z0-9_-]{43}$'),
 expires_at timestamptz NOT NULL
);
CREATE INDEX scorekeeper_oidc_flows_expiry ON scorekeeper_oidc_flows(expires_at);

