# Hub schema compatibility review — Production HOLD

Read-only catalog inspection, November 24, 2026: FTG Hub project `rough-unit-04966087`, default branch `br-super-base-axndwya2` (`main`), database `neondb`. Only table structure was requested; no game/player rows or credentials were read. The three existing Hub tables are not modified by this draft.

| Compatibility item | Observed schema | Draft remediation |
| --- | --- | --- |
| Event/game/player keys | UUIDs with `gen_random_uuid()` defaults | Server-authoritative UUID validation and a separate UUID receipt migration; legacy bigint fixture still supported. |
| Event/game binding | Unique `(event_id,game_number)`, FK to events | Transactional revision/receipt and row locks preserve existing slot binding. |
| Date/time | `date` and `time without time zone` | One-team capture requires valid calendar date and 24-hour `HH:MM` (optional seconds) or null. |
| Opponent fouls | `NOT NULL DEFAULT 0`, nonnegative check | Review-only migration permits explicit null for unknown data while preserving existing values/default; do not invent opponent stats. |
| Quarter/challenge fields | Not present | Review-only metadata migration; no historical data fabricated. |
| ID allocation | UUID default; no `ftg_games_id_seq` | Runtime privilege proposal grants sequence access only if the sequence actually exists. |

Verified in a new disposable PostgreSQL schema reconstructed from catalog types/constraints: scoped service context revision zero, UUID event/game commit, immutable receipt replay, unknown opponent fouls preserved, no event visibility change. Existing numeric fixtures and least-privilege integration regressions also pass. No SQL from these migration proposals was executed on the actual Hub main database. No Production compatibility claim for external consumers: public readers must accept null opponent fouls and the actual Vercel Hub connection must be independently attested before a separate approved migration. The legacy bigint receipt migration is for the numeric test fixture, not the actual Hub schema.
