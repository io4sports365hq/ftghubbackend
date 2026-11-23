-- Proposed identity storage for review only; never apply to Production.
-- Session tokens are random opaque values; store only SHA-256 token hashes.
CREATE TABLE scorekeeper_operator_sessions (
 token_hash char(64) PRIMARY KEY CHECK(token_hash ~ '^[a-f0-9]{64}$'),
 operator_id text NOT NULL,
 expires_at timestamptz NOT NULL,
 revoked_at timestamptz
);
CREATE TABLE scorekeeper_operator_assignments (
 operator_id text NOT NULL,
 event_slug text NOT NULL,
 game_number text NOT NULL,
 capture_id text NOT NULL,
 expires_at timestamptz NOT NULL,
 revoked_at timestamptz,
 active boolean NOT NULL DEFAULT false,
 PRIMARY KEY(operator_id,event_slug,game_number,capture_id)
);
