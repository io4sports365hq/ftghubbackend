# Hub publish handler integration gates (draft; Production HOLD)

Reviewed `api/publish.js` on the stacked backend draft branch. This is an implementation checklist, **not** approval to wire the isolated fixture into the live endpoint.

## Current behavior and gaps

1. The handler verifies a shared server credential, but **does not verify the human operator's session, event/game assignment, or permission**. That verification belongs in a separately reviewed same-origin Scorekeeper adapter. Never place the Hub secret in the browser.
2. It inserts or updates `ftg_events` with `is_published = true` **before** any game-specific revision/idempotency decision. A rejected publish must not mutate event visibility.
3. It serializes by event/game and checks capture collision, but **does not enforce expected revision, canonical payload digest, idempotency key, or durable receipt**. Repeating the same request currently rewrites game/player rows and refreshes timestamps.
4. The current `ftg_games` upsert and `ftg_game_players` replacement are inside one transaction. A future receipt/version write must join **that same transaction**, never run as a second commit.
5. `lib/publish-atomic-fixture.cjs` is an isolated fixture using `scorekeeper_fixture_*` tables, **not** a production-ready integration or an authorization boundary.

## Required order for a reviewed implementation

- Fail closed on missing operator identity, event/game assignment, capture binding, and server-to-server authentication **before connecting to the database**.
- Validate a versioned request contract (including revision, idempotency key, digest, and bounded payload); calculate the canonical digest server-side and compare it in constant time.
- Resolve an **existing authorized event**. Do not create an event or flip `is_published` in response to a Scorekeeper publish request.
- Begin a transaction, acquire the event/game advisory lock, read version and immutable receipt rows, and decide replay/conflict before modifying game or player tables.
- For a valid new revision only, update the real game/player rows, version, and append-only receipt **within the same transaction**; commit once. Return the original receipt for exact replay with no writes.
- On conflict or failure, roll back and ensure game, players, version, receipts, and event visibility are unchanged.

## Remaining acceptance evidence

- Disposable PostgreSQL tests against the **real** `ftg_games` and `ftg_game_players` schema and handler-level response contract.
- Concurrent same-key and different-key submissions, stale revisions, cross-capture conflicts, injected player-write failures, receipt persistence, and read-after-commit replay.
- An authenticated, assignment-checked Scorekeeper server adapter; secret handling and session expiry tests.
- Explicit review and approval for the schema migration, adapter, and endpoint change. **No Production deployment or publishing under this draft.**
