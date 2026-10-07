# Plan: Sermon Comments (replaces Notes)

Design source of truth: Isaac's C0 decisions plus the council's settled design. The design file lives
in a session scratchpad and will not survive, so everything it binds is restated in §A. **§A is
binding.** Changing any row there is a plan amendment, not an executor's call.

Isaac's six requests: (1) remove all Notes components including backend, (2) copy the reference
player style, (3) allow commenting on sermons per the reference, (4) a backend for comments, (5)
view sermon comments from the admin portal, (6) allow comments to be deactivated or deleted.

Execution log: the append-only root `status.md`, never this file. Every step names the entry it
appends: a heading `## COMMENTS — <step id> <short title>` followed by the line
`[COMMENTS — <step id> <short title>] <agent: …> <ISO-8601 UTC timestamp>`, then the body.

Branch: `feat/sermon-comments` off a clean `main` (Step S0). One controlled merge at
`[HUMAN_GATE C5]`.

Executors halt **only** at gates. Between gates they run to the step's acceptance criteria. If
reality diverges from this plan, the executor stops and the Conductor decides whether to amend.

---

## Goal

Notes is gone from every layer. Logged-in viewers can read, post, delete their own, report and
block-by-comment on flat, plain-text comments under a restyled player. Staff moderate them from an
admin-portal queue under a role matrix Isaac has approved, with the App Store 1.2 safety floor in
place.

## Definition of Done

- [ ] No Notes code remains: `grep -rniE "SermonNote|sermon_notes|notes_service|NotePublic|NoteCreate|NoteUpdate|useNotes|useMyNotes|NotesDrawer|NotesPanel|NoteListItem|NoteComposer|queryKeys\.notes|/notes"` over `app/ tests/ main.py mobile/app mobile/components mobile/lib admin_portal/app admin_portal/components admin_portal/lib` returns only the Notes drop migration, `3a78d016e403_add_sermon_notes.py`, and ADR text.
- [ ] Drop migration and comments migration both round-trip `upgrade head → downgrade -1 → downgrade -1 → upgrade head` on Testcontainers Postgres.
- [ ] Live `SELECT count(*) FROM sermon_notes` = 0 is recorded in `status.md` for every hosted DB at C1, and again at C5.
- [ ] Every §A.4 endpoint exists. The viewer DTO never carries `user_id`, email or role (asserted by a test on the serialised JSON keys).
- [ ] Every row of the §A.6 role matrix has a passing endpoint test, including the uniform 404 cases.
- [ ] Auto-hide fires at `COMMENTS_AUTO_HIDE_THRESHOLD` distinct reporters (default 3) and is reversible. The re-arm rule in §A.5 has a test.
- [ ] URL rejection, the keyword blocklist, the body normalisation rules and the DB CHECK each have a test.
- [ ] The rate limits in §A.7 return 429 through `ContentError`. A log-capture test proves comment bodies are never logged.
- [ ] `app/scripts/purge_comment_snapshots.py` nulls `body_snapshot` older than 90 days, and has a test. Compose has an `ops`-profile one-shot stub for it.
- [ ] `openapi.json`, `mobile/lib/api/schema.d.ts` and `admin_portal/lib/api/schema.d.ts` are regenerated and committed. The OpenAPI diff was approved at C3.
- [ ] Mobile: player restyled per §A.8 with 10s skip, including the lock-screen/remote path. Comments panel, terms sheet, full_name prompt, Me name edit and published contact info all ship. `npm run verify` is green in `mobile/`.
- [ ] Admin portal: `/(portal)/comments` queue, nav count and the sermon-editor Comments card ship. `npm run verify` is green in `admin_portal/`.
- [ ] `uv run pytest -q --tb=short` is green against real Postgres (Testcontainers). No ORM or session mocks were added.
- [ ] ADR-0012 "Retire Notes" and ADR-0013 "Sermon comments" exist in `docs/adr/` (numbering per §A.10).
- [ ] `security-reviewer` signed off before C4 and C5. `reviewer-gilfoyle` signed off before C3 and C5.
- [ ] **No scope creep.** Nothing in §Out of scope ships.

---

# A. Binding design (restated)

## A.1 Isaac's C0 decisions (final)

| # | Decision |
|---|---|
| D1 | Post-moderation: comments go live immediately. Auto-hide after N **distinct** reporters is ON by default; N is config `COMMENTS_AUTO_HIDE_THRESHOLD`, default 3. An auto-hide sets status HIDDEN with `hidden_auto=true` and is reversible by restore. The author sees "Under review" for an auto-hide and "Removed by a moderator" for a manual hide. |
| D2 | Recent sort only. No likes, no Top, no like count, no likes table. Top and like UI are absent, not disabled. |
| D3 | Minors are in the audience; ties go to the safety-leaning option. URLs are rejected in bodies. A server-side keyword blocklist is the objectionable-content floor. Every report carries a reason enum: `spam, harassment, hate, sexual, self_harm, other`. |
| D4 | App Store 1.2 floor is in scope: report on every comment, an admin reports queue, a per-viewer **Block user** (`user_blocks` table, applied at the query layer, exposed by comment id), Terms/EULA acceptance with a no-tolerance clause gating the first comment (`users.comments_terms_accepted_at`, in the C2 migration), and published contact info in the app. |
| D5 | `comment_moderation_log` keeps a `body_snapshot` for 90 days on **moderator hard-delete only**. A scheduled script in `app/scripts/` purges it. Compose gets an ops service stub (`archive-sweep` is the precedent). Author self-delete never stores the body. |
| D6 | `full_name` is required before the first comment. There is no "Member" fallback. The public name is "First L.", computed server-side, never from email. A one-time composer notice reads "You'll appear as '<name>'" and links to name editing. **Verified:** the Me screen cannot edit `full_name` today and there is no self-update endpoint, so both are in scope (S6, S13). |
| D7 | A deactivated user's existing comments stay visible. Only an explicit hide or delete removes a comment from view. |
| D8 | Sequencing precondition: see S0. This plan does not perform or authorize the R2 merge. |
| D9 | No real Notes data exists on any hosted DB. Use a single-phase drop. The live zero-row count on every hosted DB is still mandatory; any count > 0 halts. |
| D10 | Player: 10s skip replaces 15s, including the lock-screen/remote path. Keep the sleep timer (moon in the overlay bar). Use our brand/theme tokens, not the reference's white panel or violet accent. |
| D11 | Out of scope: account deletion (App Store 5.1.1(v)), tracked separately. Comments fully replace Notes, with no private option. |

## A.2 Comment rules

- Flat: no replies, no edit. Login is required to read, post or report.
- Body: plain text, 1–1000 characters after stripping leading/trailing whitespace, control characters and bidi characters. Enforced in the Pydantic request model **and** by a DB CHECK (`char_length(body) BETWEEN 1 AND 1000`).
- `sermon_id` comes from the URL path only. Only `PUBLISHED` sermons past `publish_at` are visible, using the Notes service's existing 404 rule (S3 lifts that rule into the comments service before deleting Notes). Comments on paid sermons need the same entitlement as playback.
- The viewer list reads from the primary (`get_db`), not the replica.
- Pagination: `Page[T]` (`app/models/content_schemas.py`) with offset. `total` is the count. The client dedupes by id.
- Errors: `ContentError` (`app/services/content_service.py`). No new error hierarchy. Because `ContentError` carries no machine code, the client checks the prerequisites (name set, terms accepted) proactively from `/auth/me`. The server's 403s are the backstop.
- Public name: a new helper next to the existing `display_name()` in `content_service.py`. The first token of `full_name`, a space, the first letter of the last token and a period ("Nii O."). A single token renders as-is. The existing `display_name()` is not changed.

## A.3 Schema (one migration, `[HUMAN_GATE C2]`)

**`sermon_comments`:** `id` uuid PK; `sermon_id` FK CASCADE; `user_id` FK CASCADE (erasure erases);
`body` text with CHECK; `status` `VISIBLE|HIDDEN` (`native_enum=False`); `hidden_at`;
`hidden_by_id` FK SET NULL; `hidden_reason`; `hidden_auto` bool not null default false;
`report_count` int not null default 0, updated in the same transaction as the report insert;
`created_at`.
Indexes: `(sermon_id, status, created_at DESC, id)`; `(user_id, created_at)`; partial
`WHERE report_count > 0` for the queue; `(status, created_at)`.

**`sermon_comment_reports`:** `id`; `comment_id` FK CASCADE; `reporter_id` FK CASCADE; `reason`
enum (`native_enum=False`); `detail` optional text capped at 500; `created_at`;
UNIQUE(`comment_id`, `reporter_id`).

**`comment_moderation_log`** (append-only): `id`; `comment_id` plain uuid, **no FK**; `actor_id`
FK SET NULL (null for `auto_hide`); `action` `hide|restore|hard_delete|self_delete|auto_hide`;
`reason` (CHECK: not null for `hide` and `hard_delete`); `sermon_id` and `author_id` plain uuids,
no cascade; `body_snapshot` nullable (CHECK: null unless `action = 'hard_delete'`); `created_at`.

**`user_blocks`:** `blocker_id` FK CASCADE; `blocked_id` FK CASCADE; `created_at`;
PK(`blocker_id`, `blocked_id`); CHECK `blocker_id <> blocked_id`.

**`users.comments_terms_accepted_at`:** nullable timestamptz.

Everything is additive. The downgrade drops exactly these objects.

## A.4 API (contract approved at `[HUMAN_GATE C3]`)

Removed: every route in `app/api/notes.py` (GET/POST `/sermons/{id}/notes`, GET `/me/notes`,
PATCH/DELETE note).

**Viewer router `app/api/comments.py`** (any authenticated active user):

| Method | Path | Notes |
|---|---|---|
| GET | `/sermons/{sermon_id}/comments` | `Page[CommentPublic]`, recent first. Excludes HIDDEN except the viewer's own, and excludes authors the viewer blocked. `total` uses the same filter. |
| POST | `/sermons/{sermon_id}/comments` | 201 `CommentPublic`. 403 if `full_name` is blank or terms are not accepted. 422 on URL, blocklist hit or length. 429 on rate limit. |
| DELETE | `/comments/{comment_id}` | Author self-delete is a hard delete with a `self_delete` log row and no snapshot. 404 if not owner. 409 while HIDDEN. |
| POST | `/comments/{comment_id}/report` | Body `{reason, detail?}`. Self-report is ignored (204, no row). A duplicate is idempotent (204). |
| POST | `/comments/{comment_id}/block` | Blocks the comment's author for this viewer. Idempotent. Blocking yourself is ignored. |
| DELETE | `/me/blocks/{block_id}` | Unblock. |
| GET | `/me/blocks` | `list[BlockPublic]` = `{id, display_name, created_at}`. No user ids. |
| POST | `/me/comments-terms` | Sets `comments_terms_accepted_at` if null. Idempotent. |

`BlockPublic.id` is an opaque id for the block row. `user_blocks` therefore gets a surrogate `id`
uuid with UNIQUE(`blocker_id`, `blocked_id`) in place of the composite PK in §A.3. The
"no user ids in viewer DTOs" rule outranks the PK shape. This is a planner resolution and is shown
to Isaac at C2.

**Auth router `app/api/auth.py`:** add `PATCH /auth/me` `{full_name}`, using the same normalisation
as comment bodies, 1–100 chars. `UserPublic` gains `comments_terms_accepted_at`.

**Admin router `app/api/admin_comments.py`:**

| Method | Path | Roles |
|---|---|---|
| GET | `/admin/comments?sermon_id&status&reported_only&sort=recent\|most_reported` | EDITOR (own sermons only, ADR-0004 pattern), MANAGER, ADMIN |
| POST | `/admin/comments/{id}/hide` `{reason}` | MANAGER, ADMIN. Idempotent. |
| POST | `/admin/comments/{id}/restore` | MANAGER, ADMIN. Idempotent. |
| DELETE | `/admin/comments/{id}` `{reason}` | ADMIN only. Writes `body_snapshot`. |

**DTOs (`app/models/content_schemas.py`):**
`CommentPublic = {id, sermon_id, author_display_name, body, created_at, is_mine, status}`, where
`status` is meaningful only when `is_mine`, plus `hidden_label` of `"under_review" |
"removed_by_moderator" | null` for own HIDDEN rows. It never carries the actor or reporter.
`CommentAdmin` is a separate schema that adds `status, hidden_at, hidden_by_id, hidden_reason,
hidden_auto, report_count, sermon_title, author_id, author_email`.

## A.5 Moderation states and weaponisation mitigations (planner's call, kept small)

- VISIBLE ⇄ HIDDEN: `hide` / `restore` by MANAGER or ADMIN. Hard delete is ADMIN only, with a reason and a confirm dialog. Self-delete is not allowed while HIDDEN.
- Auto-hide: after a report insert, if the comment is VISIBLE and the count of distinct reporters **whose report was created after the comment's most recent `restore` log row** ≥ N, set HIDDEN, `hidden_auto=true`, and write an `auto_hide` log row in the same transaction.
- Mitigations:
  1. Distinct reporters only, and self-reports are ignored.
  2. Reports are rate-limited per reporter (§A.7).
  3. **Re-arm rule:** after a moderator restores an auto-hidden comment, only reports filed after the restore count toward the next auto-hide. A brigade cannot re-hide it with the same reports.
  4. The admin queue surfaces `hidden_auto` rows first under `reported_only`, so a wrongful auto-hide is one click from restore.
- No reputation scoring, no reporter-age thresholds.

## A.6 Role matrix (approved at `[HUMAN_GATE C4]`)

| Action | Anonymous | VIEWER | Author (own) | EDITOR | MANAGER | ADMIN |
|---|---|---|---|---|---|---|
| Read viewer list | 401 | yes | yes | yes | yes | yes |
| Post | 401 | yes | — | yes | yes | yes |
| Self-delete | 401 | 404 | yes (409 if HIDDEN) | 404 non-own | 404 non-own | 404 non-own (uses admin route) |
| Report / block | 401 | yes | ignored | yes | yes | yes |
| Admin list | 401 | 403 | — | own sermons only | all | all |
| Hide / restore | 401 | 403 | — | 403 | yes | yes |
| Hard delete | 401 | 403 | — | 403 | 403 | yes |

Inactive users are rejected at auth (existing behaviour). Non-owner requests for comment-scoped
viewer routes get a uniform 404.

## A.7 Safety floor and limits

- Rate limits use the existing `check_rate_limit` in `app/core/rate_limit.py` (it fails open; accepted). Posts: 5/min and 30/h per user. Reports: 15/h per user. Blocks: 30/h per user. Exceeding a limit raises `ContentError(429)` with `Retry-After`.
- URL rejection: a regex for scheme (`https?://`), `www.`, and bare `label.tld` tokens.
- Blocklist: a word list in a plain-text data file loaded once at import, matched on normalised, case-folded word boundaries. The executor seeds a minimal list; Isaac reviews it at C4.
- Comment bodies are never logged at any level, including in error paths.

## A.8 Mobile UI

- **Player:** black header with back chevron and title. A tap-to-toggle overlay that auto-hides after ~3s, with circular rewind-10, play and forward-10. A bottom bar with seek, elapsed/total, speed pill, fullscreen (expo-video native, no new dependency) and the sleep moon. `useProgressFlush` unchanged. Brand tokens only.
- **Comments** (`mobile/app/player/_comments/`): `CommentsPanel`, `CommentRow`, `CommentComposer`, `ReportSheet`, and the block action. A "{n} comments" header with no sort toggle. `KeyboardAvoidingView`. Offline shows "Comments unavailable offline" and never blocks playback. A terms sheet and a full_name prompt appear before the first post.
- **Avatar:** the design names a shared `components/InitialsAvatar`. `mobile/components/Avatar.tsx` already derives initials (`initialsFrom`) with a seeded palette, so it **is** that component. Seed it with `author_display_name`, since there is no user id in the DTO. No duplicate component.
- **Hook** `mobile/lib/query/hooks/useComments.ts`: posting is NOT optimistic (prepend the server row). Delete and block are optimistic. Reporting hides the row locally for the reporter.

## A.9 Admin portal UI

A global `/(portal)/comments` queue (reported, hidden, per-sermon filters) and a pending/reported
count in the nav (`admin_portal/components/portal/nav-config.ts`). A Comments card in
`admin_portal/components/sermons/editor/sermon-editor.tsx` deep-links to the queue filtered by
sermon. No new BFF routes; the `admin_portal/app/api/bff/[...path]` proxy covers them. The UI gates
by role cosmetically; the server stays the authority.

## A.10 ADR numbering (verified)

`docs/adr/` is tracked in git (`git check-ignore` returns nothing) and currently ends at `0010`.
`plans/plan-r2-storage.md` step R1.11 reserves **ADR 0011** ("Object storage: R2 + Deep Archive").
That ADR lands on `main` before this branch exists (S0). The design's labels therefore map to:

| Design label | File in this plan |
|---|---|
| ADR-0011 "Retire Notes" | `docs/adr/0012-retire-notes.md` |
| ADR-0012 "Sermon comments: moderation model, API, safety floor" | `docs/adr/0013-sermon-comments.md` |

S0 verifies that `0011-*` is R2's ADR and that `0012`/`0013` are free. If not, halt to the Conductor
for an amendment.

## Out of scope

Likes, Top sort, replies, edit, private notes, account deletion, push notifications for comments,
reporter reputation, new BFF routes, new npm or Python dependencies, any change to
`useProgressFlush`, hosted-environment deploys (this plan ends at the merge).

---

# B. Steps

Four phases. Each phase is at most six steps and is the Conductor's dispatch unit.
Parallelisable: S1 ∥ S2; S12 ∥ S13 once C4 is crossed.

## Phase 0: Preconditions and design

### S0 — Verify the sequencing precondition and cut the branch
- **Owner agent:** `noob-dev`
- **Inputs:** §A.1 D8, §A.10.
- **What:** Verify, read-only, that all of the following hold, then cut the branch.
  1. `feat/r2-storage` has been merged to `main` through **R2's own `[HUMAN_GATE R8]`**. This plan neither performs nor authorizes that merge. If it has not happened, stop.
  2. The unrelated staged mobile batch has been split into its own commit and is not riding on this branch.
  3. `git status` on `main` is clean.
  4. `docs/adr/0011-*` is R2's ADR, and `0012`/`0013` are free.
  5. `uv run alembic heads` shows one head. Record it: S3's `down_revision` uses it. Do not assume `b2c3d4e5f6a7`, because R2 adds a migration.

  Then `git switch -c feat/sermon-comments main`.
- **Outputs:** the branch, and the recorded alembic head.
- **Acceptance:** all five checks pass. `git log --oneline -1` on the branch equals `main`. Run the baseline `uv run pytest -q --tb=short` and `npm run verify` in both `mobile/` and `admin_portal/`, and record the counts.
- **Status entry:** `[COMMENTS — S0 precondition + branch]` with the main SHA, the alembic head, the ADR listing, and the baseline test counts. If any check fails, the entry reads `HALTED: <check>` and execution stops.

### S1 — Test strategy before implementation
- **Owner agent:** `qa-strategist`
- **Inputs:** §A in full; `tests/conftest.py` (Testcontainers `PostgresContainer("postgres:17")` fixture); `tests/test_notes.py` as the precedent for sermon-scoped endpoint tests.
- **What:** Write the test matrix for every backend and client step. Name each layer and fixture. Rules:
  - Endpoint and service tests use real Postgres through the existing Testcontainers fixture and `app.dependency_overrides`. **No ORM or session mocking.**
  - Use real Redis where rate-limit behaviour is asserted. Otherwise use the existing test Redis handling.
  - Mobile uses Jest with the existing `__mocks__` and mocked HTTP at the API-client seam. Admin uses Vitest.
- **Must cover:** each §A.6 cell, including the uniform 404s; the §A.5 auto-hide threshold and re-arm rule; the concurrent double-report race on UNIQUE; `report_count` consistency; the viewer DTO key allow-list; block filtering for both list and `total`; HIDDEN-own visibility with each label; publish_at/PUBLISHED/entitlement gates; normalisation and CHECK parity (a body valid in Pydantic is valid in the DB, and vice versa); URL and blocklist rejections; 429s; no-body-in-logs; the snapshot purge at the 90-day boundary; deactivated-author visibility; both migration round-trips; and on the client the 10s skip, including the lock-screen path.
- **Outputs:** the test matrix as the body of the status entry (layer, test file, case list), mapped to step IDs. Test files are named `tests/test_comments.py`, `tests/test_admin_comments.py`, `tests/test_comment_moderation.py`, `tests/test_purge_comment_snapshots.py` and `tests/test_migrations_comments.py`.
- **Acceptance:** every DoD bullet maps to at least one named test case. The Conductor checks the mapping before dispatching S3.
- **Status entry:** `[COMMENTS — S1 test strategy]` containing the full matrix.

### S2 — Visual design for player, comments and admin queue
- **Owner agent:** `ui-designer`
- **Inputs:** §A.8, §A.9, the reference description (black header, circular overlay controls, initials-avatar rows, pill composer, hairline dividers), the existing brand tokens in `mobile/` and `admin_portal/`, and `mobile/components/Avatar.tsx`.
- **What:** Write a spec for:
  - the player header, overlay and bottom bar, including the auto-hide timing, hit targets and fullscreen affordance;
  - the comments panel, row, composer, report sheet (reason enum), block confirm, terms sheet, full_name prompt, one-time "You'll appear as" notice, HIDDEN-own row treatment, offline state and contact-info placement on Me;
  - the admin queue table, filters, hide/restore/delete flows (including the delete confirm with reason), nav badge and editor card.

  Use brand tokens only: no white panel, no violet. There is no Top or like UI anywhere. Include accessibility treatment (labels, contrast, dynamic type).
- **Outputs:** `docs/design_mobile_app/comments-and-player.md` and `docs/design_admin_portal/comments-queue.md`. Both directories exist.
- **Acceptance:** every component named in §A.8 and §A.9 has a spec entry with token references. There is no new dependency.
- **Status entry:** `[COMMENTS — S2 UI design]` with both file paths and any token gaps found.

## Phase 1: Backend

### S3 — Remove Notes from the backend and write the drop migration
- **Owner agent:** `senior-dev-backend`
- **Inputs:** S0's alembic head; S1's matrix; the verified Notes inventory:
  - `app/models/models.py` (`SermonNote`, ~L650–705)
  - `app/models/content_schemas.py` (`NoteCreate`/`NoteUpdate`/`NotePublic`, ~L726–750)
  - `app/api/notes.py`
  - `app/services/notes_service.py`
  - `main.py` L19 import and L196 `include_router`
  - `tests/test_notes.py`
- **What:**
  1. Lift the sermon-visibility and entitlement 404 rule out of `notes_service.py` into the new `app/services/comments_service.py`, copied with its tests' intent.
  2. Delete the Notes model, schemas, router, service, `main.py` wiring and `tests/test_notes.py`.
  3. **Verified:** `app/scripts/seed_dev.py`, `app/scripts/dump_openapi.py` and `tests/conftest.py` contain no `SermonNote` reference. Re-grep them anyway, and record the result.
  4. Write a new revision, `drop_sermon_notes`. `upgrade` drops both indexes and the table. `downgrade` recreates the empty table and both indexes exactly as `alembic/versions/3a78d016e403_add_sermon_notes.py` did ("schema-reversible, not data-reversible", stated in the docstring).
- **Outputs:** the deletions, the new migration file, and the comments service skeleton holding only the lifted visibility rule.
- **Acceptance:** the DoD Notes grep is clean for backend paths. On Testcontainers Postgres, `alembic upgrade head → downgrade -1 → upgrade head` passes. `uv run pytest -q --tb=short` is green (the count drops by exactly the Notes tests). The migration is **not** run against any hosted DB.
- **Status entry:** `[COMMENTS — S3 notes backend removal + drop migration]` with the revision id, round-trip output tail, test counts and grep results.

### [HUMAN_GATE C1] — Notes drop migration
**This is a destructive migration. Isaac's standing rule is "migrations additive, never silently
destructive."** This revision breaks the additive default deliberately, and is made non-silent by
this gate, its own revision, and ADR-0012.
- **Precondition (mandatory, not skippable):** run `SELECT count(*) FROM sermon_notes;` live against **every hosted DB**. Isaac enumerates the hosted DBs at this gate. Record each DB name and count in `status.md` under `[COMMENTS — C1 zero-row counts]`. **Any count above zero halts the plan.** The single-phase drop is then void, and the Conductor brings an amendment.
- Isaac reviews: the migration file, the round-trip evidence, and the backend Notes deletion diff.
- Crossing C1 approves the migration file only. It runs on hosted DBs only through a later deploy (out of scope), which re-runs the count first (see C5).

### S4 — ADR: Retire Notes
- **Owner agent:** `scribe`
- **Inputs:** C1 outcome and counts; §A.1 D9 and D11; S3's revision id; ADR format from `docs/adr/0010-cloudflare-stream-media-pipeline.md`.
- **What:** Write `docs/adr/0012-retire-notes.md`. Cover:
  - that it reverses the strictly-private Notes design (the `SermonNote` docstring: no staff read path by design);
  - why comments replace Notes with no private option;
  - data disposition: zero rows verified live per hosted DB on the date of C1, a single-phase drop, and a downgrade that is schema-only;
  - the explicit exception to the additive-migration rule.
- **Outputs:** the ADR file.
- **Acceptance:** cites the C1 counts and the revision id. Status: Accepted. No generic prose.
- **Status entry:** `[COMMENTS — S4 ADR-0012 retire notes]`.

### S5 — Comments schema: migration and ORM models
- **Owner agent:** `senior-dev-backend`
- **Inputs:** §A.3 (with the `user_blocks` surrogate id from §A.4); S1's migration test cases.
- **What:** Add ORM models to `app/models/models.py` and add `User.comments_terms_accepted_at`. Write one new revision on top of S3's revision, containing every table, CHECK, index, partial index and the user column in §A.3. Write an exact-inverse downgrade.
- **Outputs:** the models and the migration file.
- **Acceptance:** the migration is purely additive. Round-trip passes on Testcontainers Postgres. `tests/test_migrations_comments.py` asserts the CHECKs reject bad rows at the DB (body length, `reason` required for hide/hard_delete, `body_snapshot` only on hard_delete, self-block). The suite is green.
- **Status entry:** `[COMMENTS — S5 comments schema]` with the revision id, the DDL summary and the round-trip tail.

### [HUMAN_GATE C2] — Comments migration
- Isaac reviews the migration covering `sermon_comments`, `sermon_comment_reports`, `comment_moderation_log`, `user_blocks` and `users.comments_terms_accepted_at`, and the round-trip evidence.
- Shown explicitly: the `user_blocks` surrogate-id resolution (§A.4), `hidden_auto` as the auto-hide marker, and the FK and cascade choices (`comment_id` with no FK on the log; author erasure cascades the comments).

### S6 — Viewer comments: service, router and profile edit
- **Owner agent:** `senior-dev-backend`
- **Inputs:** §A.2, §A.4 (viewer and auth rows), §A.5, §A.7; S1's matrix.
- **What:**
  - `app/services/comments_service.py`: list (primary DB, block filter, HIDDEN-own with label), post (prerequisites, normalisation, URL and blocklist checks, rate limit), self-delete (log row, no snapshot), report (UNIQUE, `report_count` in the same transaction, auto-hide with the re-arm rule), block/unblock/list, terms acceptance.
  - `app/api/comments.py`: a thin router, wired in `main.py`.
  - DTOs in `content_schemas.py`. The "First L." helper.
  - `PATCH /auth/me` in `app/api/auth.py`, and `comments_terms_accepted_at` on `UserPublic`.
  - Config `COMMENTS_AUTO_HIDE_THRESHOLD` (default 3) in `app/core/config.py`, with the `.env.example` placeholder.
  - The blocklist data file and its loader.
- **Outputs:** the code, plus `tests/test_comments.py` and `tests/test_comment_moderation.py` (the viewer-side and auto-hide parts).
- **Acceptance:** every S1 case for these surfaces passes against real Postgres. The DTO key allow-list test passes. The no-body-in-logs test passes. Suite green.
- **Status entry:** `[COMMENTS — S6 viewer comments API]` with test counts and the threshold and limit values used.

### S7 — Moderation: admin router, moderation log and snapshot purge
- **Owner agent:** `senior-dev-backend`
- **Inputs:** §A.4 (admin rows), §A.5, §A.6; `require_role` in `app/core/dependencies.py`; the ADR-0004 author-scoped pattern (`docs/adr/0004-sermons-author-scoped-filter.md`); the compose `archive-sweep` ops stub.
- **What:**
  - `app/api/admin_comments.py` and its service functions: list with filters and both sorts, EDITOR scoping, idempotent hide/restore, ADMIN hard delete with snapshot.
  - `app/scripts/purge_comment_snapshots.py`: nulls `body_snapshot` where `created_at < now() - 90 days`, and logs only counts.
  - A `docker-compose.yml` `ops`-profile one-shot service stub, `comment-snapshot-purge`, following the `archive-sweep` stub's shape.
- **Outputs:** the code, `tests/test_admin_comments.py`, `tests/test_purge_comment_snapshots.py`, and the compose stub.
- **Acceptance:** every §A.6 admin cell has a passing test. The purge boundary test passes. `docker compose config` resolves. Suite green.
- **Status entry:** `[COMMENTS — S7 moderation API + purge]`.

### S8 — Regenerate the OpenAPI contract and both client types
- **Owner agent:** `noob-dev`
- **Inputs:** S6 and S7 merged on the branch.
- **What:** Regenerate `openapi.json` with `app/scripts/dump_openapi.py`. Run `npm run gen:api` in `mobile/` and in `admin_portal/`. Produce a route-level OpenAPI diff against `main` (removed, added and changed paths and schemas) for C3.
- **Outputs:** the three regenerated files and the diff.
- **Acceptance:** `admin_portal` `npm run typecheck` is green. `mobile` typecheck is **expected to fail** only on Notes references, which S13 removes. Record the exact failing files; any other failure halts.
- **Status entry:** `[COMMENTS — S8 openapi regen]` with the diff.

### S9 — ADR: Sermon comments
- **Owner agent:** `scribe`
- **Inputs:** §A in full; S8's diff.
- **What:** Write `docs/adr/0013-sermon-comments.md`, "Sermon comments: moderation model, API, safety floor". Cover post-moderation with auto-hide and the re-arm rule, the role matrix, the DTO privacy rule, block-by-comment-id, the terms gate, the full_name requirement and public-name rule, snapshot retention, rate limits, and the minors-in-audience tiebreak.
- **Outputs:** the ADR, with status **Proposed**. S17 flips it to Accepted.
- **Acceptance:** every §A.1 decision appears with its rationale.
- **Status entry:** `[COMMENTS — S9 ADR-0013 comments]`.

### S10 — Backend code review
- **Owner agent:** `reviewer-gilfoyle`
- **Inputs:** the branch diff for S3 through S8.
- **What:** Review for correctness, transaction boundaries (report, count and auto-hide in one transaction), N+1 queries on the list, index use for the list and queue queries, idiomatic async SQLAlchemy, thin routers, and no "while I'm here" edits.
- **Acceptance:** no unresolved must-fix items. Fixes go back to `senior-dev-backend` and are re-reviewed.
- **Status entry:** `[COMMENTS — S10 gilfoyle backend review]` with the verdict.

### [HUMAN_GATE C3] — Public API contract
- Isaac reviews S8's OpenAPI diff (Notes endpoints removed, comment and admin endpoints added, `PATCH /auth/me`, `UserPublic` change), the S10 verdict, and ADR-0013 (Proposed).
- **Content inputs Isaac supplies here** (needed by S13):
  - I1: the published contact address for the app.
  - I2: the comments Terms/EULA text with its no-tolerance clause.

### S11 — Security review of moderation auth and safety floor
- **Owner agent:** `security-reviewer`
- **Inputs:** §A.6; S6 and S7 code and tests; the blocklist file; ADR-0013.
- **What:** Verify:
  - the role matrix is enforced server-side, cell by cell;
  - EDITOR scoping cannot be bypassed through `sermon_id` filters;
  - uniform 404s leak no existence;
  - no viewer DTO or error carries `user_id`, email or role;
  - blocks cannot be used to enumerate users;
  - `PATCH /auth/me` cannot be used for impersonation beyond what the length and normalisation rules allow;
  - normalisation and bidi stripping are correct;
  - the URL regex and blocklist have no trivial bypasses;
  - auto-hide cannot be weaponised beyond §A.5's accepted residual;
  - rate limits are keyed per user;
  - bodies never reach logs;
  - snapshots are purged.
- **Acceptance:** explicit sign-off, or must-fix items. Fixes go to `senior-dev-backend` and are re-reviewed.
- **Status entry:** `[COMMENTS — S11 security review: moderation auth]` with the sign-off line.

### [HUMAN_GATE C4] — Moderation auth and role matrix
- **Precondition:** S11 security-reviewer sign-off is recorded in `status.md`.
- Isaac approves §A.6 as implemented, the auto-hide threshold, the §A.5 mitigations, and the seeded blocklist.

## Phase 2: Clients (after C4)

### S12 — Admin portal comments queue
- **Owner agent:** `senior-dev-frontend`
- **Inputs:** §A.9; S2's `docs/design_admin_portal/comments-queue.md`; the regenerated `admin_portal/lib/api/schema.d.ts`.
- **What:**
  - `admin_portal/app/(portal)/comments/` route.
  - A nav entry and count in `components/portal/nav-config.ts` and its renderer.
  - A Comments card component under `components/sermons/editor/`, mounted in `sermon-editor.tsx`, deep-linking to `/comments?sermon_id=…`.
  - Hide, restore and delete flows, with a reason dialog and an ADMIN-only delete confirm.
  - Role-gated rendering (cosmetic), through the existing `[...path]` BFF proxy only.
- **Acceptance:** Vitest covers role gating, the hide/restore/delete flows and the reason-required validation. `npm run verify` is green in `admin_portal/`. No new BFF route or dependency.
- **Status entry:** `[COMMENTS — S12 admin comments queue]`.

### S13 — Mobile: remove Notes, restyle the player, ship comments
- **Owner agent:** `mobile-developer`
- **Inputs:** §A.8; S2's `docs/design_mobile_app/comments-and-player.md`; C3 inputs I1 and I2; the regenerated `mobile/lib/api/schema.d.ts`.
- **What:**
  1. **Notes removal.** Delete:
     - `mobile/app/notes.tsx` and `mobile/app/__tests__/notes.test.tsx`
     - `mobile/app/(tabs)/_me/NotesPanel.tsx` and `_me/__tests__/NotesPanel.test.tsx`
     - `mobile/components/notes/` (including `__tests__/NoteListItem.test.tsx`)
     - `mobile/lib/query/hooks/useNotes.ts` and `hooks/__tests__/useNotes.test.ts`
     - `mobile/app/player/_player/NotesDrawer.tsx`, `NoteComposer.tsx` and `__tests__/NotesDrawer.test.tsx`

     Then remove:
     - `queryKeys.notes` in `mobile/lib/query/queryClient.ts`
     - the Notes LibraryRow and `useMyNotes` in `mobile/app/(tabs)/me.tsx`
     - `<Stack.Screen name="notes" />` in `mobile/app/_layout.tsx`
     - the `<NotesDrawer>` mount and the notes cases in `mobile/app/player/[id].tsx` and `mobile/app/player/__tests__/[id].test.tsx`
     - stale "notes" doc comments in `mobile/app/player/_player/VideoSurface.tsx` and `mobile/lib/format/sermonTitleMap.ts`

     Bump the persister buster on `PersistQueryClientProvider` in `mobile/lib/query/QueryProvider.tsx`.
  2. **Player.** Set `SEEK_SECONDS` 15 → 10 in `TransportControls.tsx`. Confirm the lock-screen/remote skip interval (`showNowPlayingNotification` path in `player/[id].tsx` ~L190) is 10s, and set it if expo-video exposes it; record what it exposes. Restyle `PlayerHeader`, the overlay and the bottom bar per S2. Native fullscreen. Keep `SleepTimerSheet`/`useSleepTimer`. Leave `useProgressFlush` untouched (diff must be empty).
  3. **Comments.** Build `mobile/app/player/_comments/` (`CommentsPanel`, `CommentRow`, `CommentComposer`, `ReportSheet`, block action), `mobile/lib/query/hooks/useComments.ts` with the §A.8 optimism rules, the terms sheet (I2) calling `POST /me/comments-terms`, the full_name prompt, and the one-time notice. `Avatar` is seeded by display name.
  4. **Me.** A full_name edit (`PATCH /auth/me`, invalidating the profile query), a "Blocked users" list with unblock, and the published contact info (I1).
- **Acceptance:** the DoD Notes grep is clean for mobile paths. Jest covers the 10s skip, overlay auto-hide, comment list/post/delete/report/block, the terms and name gating, HIDDEN-own labels, and the offline state not blocking playback. `npm run verify` is green in `mobile/`. No new dependency.
- **Status entry:** `[COMMENTS — S13 mobile notes removal + player + comments]`, including the lock-screen skip finding.

## Phase 3: Close-out

### S14 — Coverage gap assessment
- **Owner agent:** `qa-strategist`
- **Inputs:** S1's matrix; all test files on the branch.
- **What:** Map every S1 case to an existing test. List gaps.
- **Acceptance:** zero unmapped must-have cases. Gaps go back to the owning executor; re-run after fixes.
- **Status entry:** `[COMMENTS — S14 coverage assessment]`.

### S15 — Final code review
- **Owner agent:** `reviewer-gilfoyle`
- **Inputs:** the full branch diff against `main`, emphasising S12 and S13.
- **Acceptance:** no unresolved must-fix items.
- **Status entry:** `[COMMENTS — S15 gilfoyle final review]`.

### S16 — Final security review
- **Owner agent:** `security-reviewer`
- **Inputs:** the full branch diff. Focus on the client surfaces:
  - no `user_id` usage on mobile;
  - the cosmetic role gating in the admin portal is backed by server checks;
  - the terms gate cannot be bypassed client-side to post (the server 403 still holds);
  - the contact info is correct;
  - no secrets in any committed file or `.md`.
- **Acceptance:** explicit sign-off.
- **Status entry:** `[COMMENTS — S16 security final review]`.

### S17 — Finalize ADR-0013
- **Owner agent:** `scribe`
- **What:** Flip ADR-0013 to Accepted, folding in any C3/C4 changes.
- **Acceptance:** the ADR matches the shipped behaviour.
- **Status entry:** `[COMMENTS — S17 ADR-0013 accepted]`.

### [HUMAN_GATE C5] — Merge to main
- **Preconditions:** S15 and S16 sign-offs are in `status.md`. All suites are green: `uv run pytest -q --tb=short`, and `npm run verify` in `mobile/` and `admin_portal/`. Re-run the live `SELECT count(*) FROM sermon_notes;` on every hosted DB and record it under `[COMMENTS — C5 zero-row recount]`; any count above zero halts.
- Isaac reviews the branch diff summary and the full `status.md` trail. The merge of `feat/sermon-comments` into `main` is his. Conventional commits on the branch.
- Deploying to any hosted environment (where `alembic upgrade head` runs as its own step) is **not** authorized by this gate.

---

## Rollback

| Failure point | Revert |
|---|---|
| Any step before C5 | `git revert` or reset on `feat/sermon-comments`. Nothing is on `main` and nothing has run on a hosted DB. |
| C1 count > 0 on any DB | Halt. Do not run the drop. The Conductor amends the plan (a two-phase export/retire path). |
| S3/S5 migration fails round-trip | Fix in place on the branch. Revisions are unapplied anywhere except Testcontainers. |
| After merge, before deploy | `git revert` the merge commit on `main`. |
| After a deploy that ran the drop (out of scope, for the record) | `alembic downgrade` to before the comments revision, then before the drop revision. That recreates an **empty** `sermon_notes` (schema-reversible, not data-reversible). The comments downgrade discards all comment, report, log and block rows; take a `pg_dump` of those four tables before any downgrade. |
| Auto-hide misfires in production | Set `COMMENTS_AUTO_HIDE_THRESHOLD` higher in config. Moderators restore from the queue. No code revert needed. |

## Risks

| # | Risk | Mitigation |
|---|---|---|
| K1 | The branch carries a broken mobile build between S8 and S13 (mobile still calls removed Notes endpoints). | Expected and recorded at S8. Nothing merges before C5, which requires `mobile` `npm run verify` green. |
| K2 | Report brigading auto-hides legitimate comments. N=3 is low by design (D3). | §A.5 mitigations: distinct reporters, a per-reporter rate limit, the re-arm rule, auto-hidden rows first in the queue. Threshold tunable by config. |
| K3 | `check_rate_limit` fails open when Redis is down. | Accepted by the council. The DB constraints (UNIQUE, CHECK) still hold. |
| K4 | The URL regex and blocklist have false positives (scripture refs like "John 3.16" look like `label.tld`) and false negatives (obfuscation). | The regex must not match digit-only TLD tokens. S1 adds scripture-reference cases. The blocklist is a floor, not a filter of record. Isaac reviews it at C4. |
| K5 | Self-editable `full_name` enables impersonation ("Pastor …"). | Within D6's design. S11 assesses it. Moderators hide and delete. Flagged, not expanded in scope. |
| K6 | expo-video may not expose the lock-screen skip interval. | S13 records what it exposes. If the interval is OS-fixed, that is reported at C5, not hacked around with a dependency. |
| K7 | ADR number collision with R2's ADR 0011. | §A.10 renumbering, verified at S0. |
| K8 | S0 is never satisfied (R2 stalls), blocking this plan. | Intended. This plan does not authorize the R2 merge or a branch off a dirty tree. |
| K9 | A body snapshot outlives 90 days if the purge job is never scheduled in a hosted environment. | The compose stub plus a DEPLOYMENT follow-up, noted in ADR-0013. Hosted scheduling is out of scope and named as a deploy prerequisite. |
| K10 | The terms text (I2) or the contact address (I1) is not supplied at C3. | S13 cannot meet acceptance without them. S13 does not ship placeholder legal text. |

## Planner resolutions (made here, shown to Isaac at the named gate)

| # | Resolution | Gate |
|---|---|---|
| P1 | ADRs numbered 0012 and 0013, not 0011 and 0012, because R2 holds 0011. | C3 |
| P2 | `user_blocks` gets a surrogate `id` so unblock and list never expose user ids. | C2 |
| P3 | Auto-hide marker is the column `hidden_auto` bool. | C2 |
| P4 | Weaponisation mitigations are §A.5 items 1–4. | C4 |
| P5 | Reports are limited at 15/h and blocks at 30/h. | C4 |
| P6 | The existing `mobile/components/Avatar.tsx` serves as the design's `InitialsAvatar`. No duplicate. | C3 |
| P7 | `PATCH /auth/me` and `UserPublic.comments_terms_accepted_at` added, because no self-edit path exists today (verified). | C3 |
| P8 | `self_harm` is the enum spelling of "self-harm/safety". | C3 |
| P9 | Terms acceptance records a timestamp only, with no version column. Re-acceptance on text change is out of scope. | C2 |

---

# Amendments

Approved by Isaac in chat on 2026-10-02 and relayed by the Conductor. Each amendment is a
deliberate deviation from the plan body as approved. It supersedes only the clauses it names, and
the rest of the plan body is still the contract. Amendments are named AM* so they cannot collide
with decision labels D* or planner resolutions P*.

## AM1 — D8 sequencing: parallel worktree off current `main`

- **Problem:** S0 as approved requires R2 to be merged through R2's own `[HUMAN_GATE R8]`, the staged
  mobile batch to be split, and a clean `main` checkout. It halted twice (see `status.md`,
  `[COMMENTS — S0 precondition + branch]` and `[COMMENTS — S0 re-attempt after D8 amendment
  decision]`). The original working tree on `feat/r2-storage` holds three things: R2's uncommitted
  work; a 10-file staged Browse/Search delta, which is main's merged mobile work and not a new batch;
  and an unrelated uncommitted verses / prophets-catalog / Home-redesign workstream. Waiting on R8
  blocks this plan indefinitely (K8).
- **Supersedes:** header line 15 ("off a clean `main` (Step S0)"); §A.1 row D8; §A.10's statement
  that ADR 0011 lands on `main` before this branch exists, and its S0 halt; S0 **What** checks 1–5,
  the `git switch` command, and S0 **Acceptance**; S3 **Inputs** only in that "S0's alembic head"
  now means the worktree head recorded under the revised check 4; Risks K7 and K8. Everything else in
  the plan body stands.

### AM1.1 — Branch and worktree
- `feat/sermon-comments` is cut from the **current** `main` as a separate git worktree:
  `git worktree add ../fastapi_sermon-comments -b feat/sermon-comments main`, which creates
  `/Users/isaacokai/Downloads/Project/fastapi_sermon-comments`.
- It runs **in parallel** with R2. It does not wait for R2's `[HUMAN_GATE R8]`. This plan still
  neither performs nor authorizes the R2 merge.
- The original working tree at `/Users/isaacokai/Downloads/Project/fastapi_sermon` (`feat/r2-storage`)
  is left exactly as it is. That covers R2's uncommitted changes, the 10-file staged Browse/Search
  delta, the uncommitted verses workstream, and its untracked migrations `a1b2c3d4e5f6` and
  `b2c3d4e5f6a7`, which are **not** on `main`. No step in this plan touches that tree's code. No
  stash, checkout, reset, discard or commit happens there on this plan's behalf.

### AM1.2 — S0 checks (replace S0 What 1–5 and S0 Acceptance)
`noob-dev` runs these read-only checks after the `git worktree add` above, all inside the worktree:
1. The worktree was cut from `main`: `git log -1` in the worktree matches `main`'s SHA.
2. `git status` in the worktree is clean.
3. List `docs/adr/` on `main` and record the highest ADR number. The numbers `0012`/`0013` in §A.10
   are **provisional** and are finalised at C5 (AM1.4 c). S0 no longer halts because R2's `0011` is
   not present yet.
4. Run `uv run alembic heads` **in the worktree** and record the single head. That head, not
   `b2c3d4e5f6a7`, becomes S3's `down_revision`. More than one head halts S0.
5. Record the baseline test counts: `uv run pytest -q --tb=short`, and `npm run verify` in both
   `mobile/` and `admin_portal/`, all run in the worktree.

The old checks 1 (R2 merged via R8) and 2 (staged batch split) are **withdrawn**. The status entry
heading `[COMMENTS — S0 precondition + branch]` is unchanged. It records the worktree path, the
`main` SHA, the alembic head, the highest ADR number, and the baseline counts. Any failed check
writes `HALTED: <check>`.

### AM1.3 — Where executors read and write (applies to every step S0–S17 and every gate)
- `plans/` and `status.md` are untracked or gitignored, so they **do not exist in the worktree**.
- All reads of this plan and all `status.md` appends go to the **original** paths:
  `/Users/isaacokai/Downloads/Project/fastapi_sermon/plans/plan-sermon-comments.md` and
  `/Users/isaacokai/Downloads/Project/fastapi_sermon/status.md`.
- All code work, test runs, migrations, `alembic`, `uv`, `npm` and git commits for this plan happen
  in `/Users/isaacokai/Downloads/Project/fastapi_sermon-comments/`. "Files / scope" paths in the plan
  body are relative to the worktree root.
- Do not create a copy of `plans/` or `status.md` inside the worktree.

### AM1.4 — Merge-time reconciliation (added to `[HUMAN_GATE C5]` criteria; not a precondition)
This is a tracked follow-up that is resolved at C5 and does not block any earlier step. C5's
preconditions gain the following items. Each is recorded under `[COMMENTS — C5 reconciliation]`
before Isaac reviews the merge:
- **(a) Alembic heads.** If R2 or the verses work lands on `main` first and leaves two heads, add an
  Alembic merge migration on `feat/sermon-comments`. It is additive, has no operations, and is
  reviewed at C5 under the same rules as C1/C2.
- **(b) Generated contracts.** Regenerate `openapi.json` and both `schema.d.ts` files
  (`admin_portal/lib/api/schema.d.ts` and the mobile one) against the rebased branch, then resolve any
  conflicts by regeneration rather than by hand-merging.
- **(c) ADR numbering.** Finalise by landing order. If `main` has taken 0012 or 0013 by then, renumber
  this plan's two ADRs to the next free numbers and update cross-references. This replaces the
  verification K7 relied on at S0.
- **(d) Overlap with the uncommitted verses workstream.** It touches mobile `_layout.tsx`,
  `queryClient.ts` and `useProgressFlush.ts`, and backend `models.py`, `content_schemas.py` and
  `main.py`. Whichever lands second resolves the conflicts. If this branch lands second, it
  resolves them at C5. If it lands first, record the conflicting hunks in `status.md` for the verses
  work's owner.

### AM1.5 — Risks (supersede K7 and K8; append K11)
| # | Risk | Mitigation |
|---|---|---|
| K7 (revised) | ADR number collision with R2's 0011 or any other ADR that lands first. | Numbers are provisional from S0 and finalised by landing order at C5 (AM1.4 c). |
| K8 (revised) | The parallel branch diverges from R2 and the verses work (two Alembic heads, conflicting generated types, shared files). | It no longer blocks the plan. It is reconciled at C5 per AM1.4 (a)–(d). |
| K11 | An executor writes `status.md` or reads the plan inside the worktree, finds nothing, and either recreates the files or loses the log. | AM1.3: absolute original paths for plan and status, worktree for code only. |

### AM1.6 — Rollback addition
- Before C5: `git worktree remove /Users/isaacokai/Downloads/Project/fastapi_sermon-comments` and
  `git branch -D feat/sermon-comments`. Both are Isaac's call. The original tree is unaffected either
  way, because AM1.1 forbids touching it.
