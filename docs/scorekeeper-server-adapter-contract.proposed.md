# Scorekeeper → Hub server adapter contract (proposed; disabled)

**Status:** Design only. No live endpoint, secret provisioning, migration, or Production activation.

## Trust boundary
Browser Scorekeeper → same-origin adapter → Hub publish API. The browser must never call Hub directly or receive `FTG_HUB_PUBLISH_SECRET`. The adapter obtains identity from a server-verified, unexpired operator session, **not** a client-provided user ID, role, event slug, or assignment.

## Required checks (fail closed)
1. Require POST, same-origin CSRF protection, and a valid server session with expiration and revocation checks.
2. Resolve an active event/game assignment from authoritative server-side records. Match the operator, event, game number, and capture ID. Reject unassigned, revoked, expired, or mismatched captures.
3. Verify the game is eligible to publish under the configured event policy. No automatic event creation, demo-event fallback, registration change, or visibility toggle.
4. Validate a versioned bounded payload and strictly typed revision and idempotency key. Derive the event/game/capture binding from the assignment; ignore or reject conflicting client identities.
5. Compute the canonical payload digest on the server. Do not trust a client-supplied digest. Generate the Hub authorization header exclusively on the server.
6. Forward the request to the Hub with a timeout and bounded response size. Do not log the secret, session cookie, raw personal data, or unredacted player payload. Return a stable safe error on transport failure.
7. Persist revisions and immutable receipts transactionally in the Hub. An identical retry returns the original receipt without mutating the game; a changed retry or stale revision returns 409.

## Negative-path acceptance matrix
- Missing, expired, revoked, forged session → 401/403; no Hub call.
- No assignment, assignment for another event/game, or wrong capture → 403/409; no Hub call.
- CSRF failure or unsupported method → reject before Hub call.
- Client overrides event slug, game number, or capture → reject; never redirect to a demo event.
- Invalid digest, revision, key, or oversized payload → 400; no Hub call.
- Duplicate identical request → original receipt; no second player rewrite.
- Duplicate key with changed payload, stale revision, or cross-capture request → 409; no mutation.
- Hub timeout or database error → safe retryable error; no claim of successful publishing.

## Required evidence before review
- Adapter tests with mocked Hub verifying **zero outbound calls** on every authorization failure.
- Disposable PostgreSQL tests for authoritative assignment lookup and the real Hub game/player/version/receipt tables.
- End-to-end tests for replay, conflict, rollback, and concurrent requests.
- Security review of session storage, CSRF, audit trail, credential rotation, migration and rollback.
- Explicit approval before merging or deploying any runtime changes.

**Production HOLD remains in force.**
