-- REVIEW ONLY: UUID Hub schema variant. Never run against Production without approval.
-- Unlike the earlier bigint disposable fixture, the real Hub uses UUID event IDs.
BEGIN;
CREATE TABLE scorekeeper_publish_versions (
  event_id uuid NOT NULL REFERENCES ftg_events(id),
  game_number text NOT NULL,
  external_game_id text NOT NULL CHECK (length(trim(external_game_id)) > 0),
  revision bigint NOT NULL CHECK (revision >= 1),
  payload_digest char(64) NOT NULL CHECK (payload_digest ~ '^[a-f0-9]{64}$'),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, game_number),
  UNIQUE (event_id, game_number, external_game_id)
);
CREATE TABLE scorekeeper_publish_receipts (
  receipt_id uuid PRIMARY KEY,
  event_id uuid NOT NULL,
  game_number text NOT NULL,
  external_game_id text NOT NULL,
  idempotency_key text NOT NULL,
  payload_digest char(64) NOT NULL CHECK (payload_digest ~ '^[a-f0-9]{64}$'),
  expected_revision bigint NOT NULL CHECK (expected_revision >= 0),
  committed_revision bigint NOT NULL CHECK (committed_revision >= 1),
  committed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, game_number, idempotency_key),
  FOREIGN KEY (event_id, game_number) REFERENCES scorekeeper_publish_versions(event_id, game_number),
  FOREIGN KEY (event_id, game_number, external_game_id) REFERENCES scorekeeper_publish_versions(event_id, game_number, external_game_id)
);
CREATE FUNCTION scorekeeper_reject_receipt_mutation() RETURNS trigger
LANGUAGE plpgsql AS $receipt_guard$ BEGIN RAISE EXCEPTION 'publish receipts are append-only'; END $receipt_guard$;
CREATE TRIGGER scorekeeper_receipts_no_update_delete BEFORE UPDATE OR DELETE ON scorekeeper_publish_receipts
FOR EACH ROW EXECUTE FUNCTION scorekeeper_reject_receipt_mutation();
COMMIT;
