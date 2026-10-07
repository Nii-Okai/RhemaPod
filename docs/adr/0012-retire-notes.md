# ADR 0012 — Retire Notes: drop `sermon_notes`, replace with comments

- **Status:** Accepted
- **Date:** 2026-10-02
- **Number:** **Provisional.** 0011 is reserved by R2's plan and is not on
  `main` yet. This number is finalised by landing order at C5
  (`plan-sermon-comments.md` AM1.4 c); if `main` has taken 0012 by then,
  renumber and fix cross-references.
- **Scope:** `fastapi_sermon` backend — removes `app/api/notes.py`,
  `app/services/notes_service.py`, `SermonNote` (`app/models/models.py`),
  `NoteCreate/Update/Public` (`app/models/content_schemas.py`), the
  `/notes` routes in `openapi.json`; migration `d1e2f3a4b5c6`
  (`drop_sermon_notes`, `down_revision = c7d8e9f0a1b2`). Mobile and
  admin-portal Notes UI removal is covered by later steps of the same plan.
- **Deciders:** Isaac (+ conductor, senior-dev-backend, scribe)
- **Relates to:** `plans/plan-sermon-comments.md` §A.1 D9 and D11, S3, S4,
  `[HUMAN_GATE C1]`; ADR 0010 (Notes shipped in `84d6203` alongside the
  media pipeline). Companion ADR for the comments design is separate.

> Notes (private, per-user, timestamped) are removed, and sermon comments
> (public to authenticated members, moderated) take their place with **no
> private "only me" option**. The `sermon_notes` table is dropped in a
> single migration. This is a deliberate, gated exception to the
> "migrations additive, never silently destructive" rule.

---

## Context

Notes were designed as strictly private. The `SermonNote` docstring states
it: "Strictly user-owned: no sharing, no staff visibility, no admin read
path", and `notes_service` deliberately granted **no staff bypass**, unlike
every other content-read surface. Staff, the review queue and admins could
not read a note by design.

The comments feature changes the product direction: members discuss a
sermon in a shared, flat thread. Keeping both surfaces means two
text-on-a-sermon features with different visibility and moderation rules,
and a second place a member has to choose between ("note" vs "comment").
Isaac decided comments fully replace Notes (D11) and that no real Notes data
exists to preserve (D9).

## Decision

Retire Notes and replace them with comments. There is **no private "only
me" option** in comments; that was Isaac's call (D11). A member who wants
to write privately has no in-app path after this change.

The `sermon_notes` table is dropped in a **single phase** (no
deprecate-then-drop sequence) by migration `d1e2f3a4b5c6`, which drops the
table and all four of its indexes:

- `ix_sermon_notes_user_created`
- `ix_sermon_notes_user_sermon_position`
- `ix_sermon_notes_sermon_id`
- `ix_sermon_notes_user_id`

(Plan text said "both" indexes; `3a78d016e403` actually created four.)

This reverses the strictly-private Notes design. It is the first point at
which user-authored sermon text becomes readable by staff (comments carry a
moderation queue); that is intended for comments, and it is not a change
to Notes' guarantees, because Notes cease to exist rather than become
readable.

### Data disposition

Stated precisely, because "zero rows" would be wrong:

- **No hosted or remote DB is provisioned** for this project. Confirmed by
  the coordinator on Isaac's behalf.
- The **only** database is the local Docker Compose dev Postgres
  (`127.0.0.1:5433`, db/user `sermon`).
- `SELECT count(*) FROM sermon_notes;` on it returned **1 row**: a manual
  test note ("This is a note added.") created **2026-09-28**. Verified
  non-production by direct inspection.
- The plan's precondition says any count above zero halts the plan (§C1).
  At `[HUMAN_GATE C1]` on **2026-10-02**, Isaac ruled the single dev row
  **non-blocking**; no amendment was needed. The row was not deleted by
  hand; it goes with the table when the migration runs on the dev DB.
- **Revision:** `d1e2f3a4b5c6`, `down_revision = c7d8e9f0a1b2`. `alembic
  heads` in the worktree shows this as the single head. Crossing C1
  approved the migration **file** only.
- **Reversibility:** the downgrade recreates the table and four indexes
  exactly per `3a78d016e403`. It is **schema-reversible, not
  data-reversible**; dropped rows are not recoverable by downgrade. The
  migration docstring says the same.
- **Hosted runs:** none exist. **C5 and any future deploy re-run the
  count** against whatever DB it targets before `alembic upgrade head`.
  A non-trivial count there is a stop, not a note.

Round-trip evidence (scratch DBs on compose PG, dev DB untouched): upgrade
head, downgrade -1, upgrade head all rc0; schema fingerprints match;
`tests/test_migration_roundtrip.py` 2 passed.

### Exception to the additive-migration rule

Isaac's standing rule: migrations are reviewable, additive, never silently
destructive. This migration is destructive. It is permitted here because it
is **explicit and gated**, not silent:

- named in an approved plan decision (D9, D11) and its own step (S3);
- behind `[HUMAN_GATE C1]`, where Isaac reviewed the migration file, the
  round-trip evidence and the Notes deletion diff;
- guarded by a mandatory live row count, with a halt on non-zero (waived
  once, by Isaac, for the one dev row above);
- recorded in this ADR.

It is an exception for this table, not a precedent. The next destructive
migration needs its own gate.

## Consequences

- **Positive:** One text-on-a-sermon surface, one moderation model. Removes
  the Notes routes, service, model, schemas and tests (-25 test functions
  net: `tests/test_notes.py`; suite 666 → 641 passed in the worktree).
  `openapi.json` shrinks by 338 lines.
- **Negative:** Members lose any private place to write about a sermon; a
  future "private note" would be a new feature. Any Notes a member later
  has on a DB this migration reaches are lost on upgrade (none known to
  exist outside the one dev row).
- **Negative:** Public API change: all `/notes` endpoints are removed, a
  contract break for any client still calling them. In-repo clients are
  updated by later plan steps; no external consumers are known.
- **Neutral:** `notes_service` had a sermon-visibility rule (published and
  `publish_at` passed). It was lifted unchanged into
  `app/services/comments_service.py` (`visible_sermon_or_404`). It had **no
  paid-entitlement check**; that gate does not exist to lift and is built
  new for comments.
- **Neutral:** Number is provisional (see header); rebase onto an R2 or
  verses-work Alembic head may require a merge migration (AM1.4 a).

## Alternatives considered

- **Keep Notes alongside comments, with a private/public toggle:**
  rejected by Isaac (D11). Doubles the surface and moderation rules, and a
  private option contradicts the design of a single moderated thread.
- **Two-phase retire (stop writes and hide UI, drop in a later release):**
  rejected. No hosted data exists to protect (D9), and a second release adds
  a dead-table window and a second gate for no safety gain.
- **Export Notes to users before dropping:** rejected. No real user data
  exists; the only row is a developer test note.
- **Soft-delete (rename table, keep rows):** rejected. Leaves an orphan
  table with personal text and no owner, in conflict with the
  "no staff read path" promise it was built under.
