# ADR 0013 — Sermon comments: moderation model, API, safety floor

- **Status:** Proposed (S17 flips to Accepted after C4/C5)
- **Date:** 2026-10-02
- **Number:** **Provisional.** Finalised by landing order at C5
  (`plan-sermon-comments.md` AM1.4 c). If `main` has taken 0013 by then,
  renumber and fix cross-references.
- **Scope:** `fastapi_sermon` backend. New: `app/api/comments.py`,
  `app/api/admin_comments.py`, `app/services/comments_service.py`,
  `app/core/text_safety.py`, `app/core/comment_blocklist.txt`,
  `app/scripts/purge_comment_snapshots.py`; migration `e5f6a7b8c9d0`
  (`add_sermon_comments`); compose service `comment-snapshot-purge`.
  Mobile and admin-portal UI is covered by later steps of the same plan.
- **Deciders:** Isaac (+ conductor, planner, senior-dev-backend, scribe)
- **Relates to:** `plans/plan-sermon-comments.md` §A.1 (D1-D7, D11), §A.3-A.7,
  `[HUMAN_GATE C1]`, `[HUMAN_GATE C2]`; ADR 0012 (Notes retired; this is its
  companion); ADR 0004 (author-scoped filter, reused for EDITOR); ADR 0005
  (user deactivation).

> Members post flat, public, plain-text comments on a sermon. Comments go
> live immediately (post-moderation). Reports, an auto-hide threshold, a
> staff queue, per-viewer blocking, a terms gate and a keyword/URL filter
> form the safety floor. Minors are in the audience, so every tie goes to
> the safer option.

---

## Context

ADR 0012 removes private Notes. Comments replace them: a shared thread per
sermon, readable by any authenticated member. That makes the app a
user-generated-content (UGC) surface for the first time. Three constraints
drive the design:

- **Minors are in the audience** (D3). Where two options are defensible, we
  pick the one that exposes less.
- **App Store guideline 1.2** requires, for UGC apps: a way to filter
  objectionable content, a way to report it, a way to block abusive users,
  published contact info, and terms users must accept. Shipping without these
  risks rejection.
- **Small team, no moderation staff on call.** Pre-moderation would stall
  every post; the model has to work with a queue checked periodically.

## Decision

### 1. Moderation model (D1)

**Post-moderation.** A comment is `VISIBLE` the moment it is posted. States
are `VISIBLE` and `HIDDEN` (`native_enum=False`, named CHECK).

- **Auto-hide is on.** When a report is inserted and the comment is `VISIBLE`,
  the count of **distinct** reporters is compared with
  `COMMENTS_AUTO_HIDE_THRESHOLD` (default **3**, `ge=1`, read at call time).
  At or above it the comment becomes `HIDDEN` with `hidden_auto=true`, and an
  `auto_hide` log row is written in the same transaction. The comment row is
  locked `FOR UPDATE` per report, so `report_count` is exact and exactly one
  `auto_hide` row is written under concurrency.
- **Re-arm rule.** Only reports created strictly after the comment's latest
  `restore` or `dismiss_reports` log row count. A moderator restore or
  dismissal resets `report_count` to 0. The same three reporters cannot
  re-hide a restored or dismissed comment. Restore, dismissal and report
  timestamps use `clock_timestamp()`; both moderator actions write their log
  row while holding the row lock.
- **Author-facing labels.** Own auto-hidden comment: "Under review"
  (`hidden_label = under_review`). Own manually hidden: "Removed by a
  moderator" (`removed_by_moderator`). The label never names the actor or
  the reporters.
- **Manual hide on an auto-hidden comment** sets `hidden_auto=false`, logs a
  `hide` with the required reason, and flips the label to "Removed by a
  moderator".
- **Weaponisation mitigations, kept small:** distinct reporters only;
  self-reports ignored; per-reporter rate limit (see Limits); re-arm rule;
  the admin queue sorts `hidden_auto DESC` first so a wrongful auto-hide is
  one click from restore. No reputation scoring, no reporter-age thresholds.
- **Accepted drift:** erasing a reporter's account does not decrement
  `report_count`.

### 2. Recent only, no likes (D2)

Comments sort by `created_at DESC, id`. No likes, no Top sort, no like
count, no likes table. The UI omits these; it does not disable them. Flat
thread: no replies, no edit.

### 3. Minors in the audience: safety tiebreaker (D3)

Stated once, applied throughout:

- URLs in bodies are rejected (no off-platform links).
- A server-side keyword blocklist is the objectionable-content floor.
- Every report carries a reason: `spam, harassment, hate, sexual, self_harm,
  other`.
- Safety-leaning choices on the planner's open questions: author-visible
  hidden state, uniform 404s, reports never expose reporter identity.
- `self_harm` reports get **no special UI, crisis link or extra notice**
  (C1 decision 4). They go to the queue like any other reason.

### 4. App Store 1.2 floor (D4)

| Requirement | Mechanism |
|---|---|
| Report content | `POST /comments/{id}/report` on every comment; staff queue |
| Block abusive users | `POST /comments/{id}/block`, per-viewer, applied at the query layer; list and unblock under `/me/blocks` |
| Terms with no-tolerance clause | `users.comments_terms_accepted_at`; gates the first post (403); `POST /me/comments-terms` is idempotent |
| Contact info | Published in the app (S13); contact email and Terms text still owed by Isaac (I1, I2) |
| Filter objectionable content | URL rejection + blocklist (below) |

**Block by comment id, not user id.** The client never receives an author
user id (DTO privacy rule), so blocking takes the comment id and the server
resolves the author. `POST .../block` returns `200 {id}` where `id` is the
`user_blocks` row id, used for Undo. It returns 200 for both new and repeat
blocks, and `{"id": null}` when it is the caller's own comment, so the
response never distinguishes the cases. Because `BlockPublic.id` must be
opaque, `user_blocks` has a surrogate `id` with UNIQUE(`blocker_id`,
`blocked_id`) instead of the composite PK in §A.3 (C2 deviation 1). A blocked
author's comments are excluded from the viewer's items **and** `total`.

### 5. Retention: moderator snapshot vs self-delete (D5)

- **Moderator hard-delete** (ADMIN only, reason required) writes the comment
  body to `comment_moderation_log.body_snapshot`, in the same transaction as
  the physical `DELETE`. A script, `app.scripts.purge_comment_snapshots`,
  nulls `body_snapshot` where `created_at` is older than 90 days. The cutoff
  is strict `<`: a row exactly 90 days old survives until the next run. Only
  `body_snapshot` is cleared; log rows are never deleted. It runs on the
  primary, logs a count only, and is wired as compose service
  `comment-snapshot-purge` (`profiles: ["ops"]`, `restart: "no"`). Scheduling
  it in deployed envs is a deploy concern. Why keep the snapshot: evidence
  for abuse/legal escalation involving minors.
- **Author self-delete** is a hard delete with a `self_delete` log row and
  **no body**. A DB CHECK enforces `body_snapshot IS NULL` unless
  `action = 'hard_delete'`.
- Self-delete checks ownership only, not sermon visibility (an author can
  remove their own comment after the sermon is unpublished). It is 404 for a
  non-owner and 409 while the comment is `HIDDEN` (the evidence rule wins).

### 6. Names: `full_name` required, "First L.", no nickname (D6)

- Posting requires a non-blank `full_name` (403 otherwise). No "Member"
  fallback.
- The public name is computed **at read time** from the author's current
  `full_name`, never stored, never from email: `public_display_name` in
  `content_service.py`, beside the unchanged `display_name()`. First token,
  space, first letter of the last token, period ("Nii O."). A single token
  renders as-is. The last-token initial is kept as typed.
- **No nickname option** (C1 decision 2). Real name only; the nickname line
  from the S2 spec must not ship. Accountability and moderation need a real
  name, and minors are present.
- The Me screen had no name editing and no self-update endpoint, so
  `PATCH /auth/me {full_name}` is added. It uses the same normalisation, URL,
  contact and blocklist checks as comment bodies, plus the reserved-title rule
  (section 11), 1-100 chars, single line. It is rate limited (section 10). Every
  content rule fails with the same 422 `This name can't be used`, so the
  response never says which rule fired or echoes the input (S11b, C-3). Length
  errors stay specific.
- A one-time composer notice shows "You'll appear as '<name>'" with a link to
  name editing.

### 7. Deactivated users (D7)

Deactivating a user (ADR 0005) does not touch their comments. They stay
visible. Only an explicit hide or delete removes one from view. Inactive
users are rejected at auth as before, so they cannot post or report.

### 8. Role matrix

| Action | Anon | VIEWER | Author (own) | EDITOR | MANAGER | ADMIN |
|---|---|---|---|---|---|---|
| Read viewer list | 401 | yes | yes | yes | yes | yes |
| Post | 401 | yes | n/a | yes | yes | yes |
| Self-delete | 401 | 404 | yes (409 if HIDDEN) | 404 non-own | 404 non-own | 404 non-own |
| Report / block | 401 | yes | ignored | yes | yes | yes |
| Admin list | 401 | 403 | n/a | own sermons only | all | all |
| Hide / restore / dismiss reports | 401 | 403 | n/a | 403 | yes | yes |
| Hard delete | 401 | 403 | n/a | 403 | 403 | yes |

- **EDITOR is scoped per ADR 0004:** `content_service.editor_scope_filter` is
  ANDed with every filter, joined on `Sermon.created_by`. A `sermon_id` the
  editor does not own returns an empty page with `total` 0, byte-identical to
  a random uuid (narrow, never widen; no existence oracle).
- **EDITOR gets a different DTO** (`CommentAdminForEditor`), chosen by the
  actor's role in the service, not a nullable field. It **omits
  `author_email` and `author_id`**. C1 decision 3 named only the email;
  `author_id` was also dropped in S7 because an editor has no action that
  needs it. Easy to restore if Isaac wants it. `hidden_by_id` stays.
- Auth order on admin routes: 401 (anon or inactive), then 403 by role
  before any lookup (no 404-vs-403 oracle, no state change or log row on
  denial), then 422, then 404.
- Non-owner access to comment-scoped viewer routes is a uniform 404.
  Report/block 404s ("Comment not found") are identical for an unknown id,
  another user's `HIDDEN` comment, and an unpublished sermon.

### 9. DTO privacy rule

Viewer DTOs never carry a user id, email, role, actor or reporter.
`CommentPublic` = `{id, sermon_id, author_display_name, body, created_at,
is_mine, status, hidden_label}`; `status` and `hidden_label` are meaningful
only when `is_mine`. `BlockPublic` = `{id, display_name, created_at}` with an
opaque block id. A key allow-list test asserts the exact `CommentPublic`
keys. Staff DTOs are separate schemas: `CommentAdminForEditor` adds `status,
hidden_at, hidden_reason, hidden_auto, report_count, sermon_title`;
`CommentAdmin` adds `hidden_by_id, author_id, author_email`. The moderator's
id is not shown to EDITORs (S11b, C-1). The client
seeds the avatar from `author_display_name`.

### 10. Rate limits

Existing `check_rate_limit` (`app/core/rate_limit.py`), per user, key
`comments:<action>:<window>:<user_id>`. It **fails open** when Redis is
down (accepted).

| Action | Limit |
|---|---|
| Post | 5/min and 30/h |
| Report | 15/h |
| Block | 30/h |
| Profile name change (`PATCH /auth/me`) | 5/h |

Exceeding raises `ContentError(429)` with `Retry-After` (Redis TTL, falling
back to the window length). The profile limit (key
`comments:profile:1h:<user_id>`, S11b SF-5) matters because a name applies
retroactively to every past comment (read-time name). **Every post and name
attempt consumes budget, including ones later rejected by URL/blocklist/validation** (C3 pin A6), so the filter
cannot be probed for free. Consequence: validation runs in the service after
the charge, so the 1-1000 length rule is enforced by the service and the DB
CHECK, not by the Pydantic request model as §A.2 literally says (S6
deviation 1; parity proven by test PAR-01). Request models still enforce
structure and `extra=forbid`. Precedence: 401, 429, 404 sermon gate, 403
(paid entitlement, name, terms), 422.

### 11. Text safety: normalisation, URL, blocklist

Shared by comment bodies, `PATCH /auth/me` and moderator `reason`
(`app/core/text_safety.py`).

- **Normalisation:** NFC; strip bidi controls, ZWSP/word-joiner/BOM, C0/C1
  controls and DEL; keep ZWJ/ZWNJ in storage (emoji, Persian, Indic) but
  remove them before URL and blocklist matching; `\n` kept (CRLF folded, 3+
  newlines capped at one blank line); tab becomes space; trim; body must
  contain at least one letter, number, punctuation, symbol or mark. Length
  is 1-1000 code points (DB CHECK `char_length(body) BETWEEN 1 AND 1000`).
  Names collapse whitespace, 1-100.
- **Match form (S11b, SF-2):** URL, contact and blocklist checks run on a
  folded copy only: NFKC, unicode dots to `.`, every Cf character and U+034F
  removed, and a small inline table folding Cyrillic and Greek look-alikes to
  Latin (no dependency). Stored text is never folded or altered by it.
- **URL rejection:** scheme (`https?://`), `www.`, and bare `label.tld`
  tokens matched against an **explicit TLD allow-list**, not any 2+ letter
  run. "Amen.Thank you", "Mr.Smith", "John 3.16" pass. This deviates from the
  plan's literal "bare label.tld regex" (see pending C3/C4). Isaac's TLD
  pruning stands: ordinary words (me, link, live, shop, today, life) are not
  in the list. They are caught only in an explicit URL shape, a dotted run
  followed by `/path` and ending in a letters-only label (`t.me/x`,
  `x.link/abc`); a bare `foo.me` passes. Scanning is a single non-nested
  pass, linear in the input (S11b, SF-7); adversarial inputs such as
  `"a."*499` run in about 1 ms and a test holds each under 20 ms.
- **Off-platform contact (S11b, SF-1):** rejected in bodies and names:
  `t.me`, `wa.me`; the words telegram, whatsapp, snapchat (with spacing and
  repeated letters tolerated, "whats app"); `@handle`; "dot com" spelled out;
  discord only in a contact shape ("on/my/add/join discord", "discord:",
  "discord server"), because "discord" is a scripture word (Prov 6:19); and
  phone numbers, meaning 7 or more digits ignoring spaces, dots, dashes,
  parentheses and a leading `+`. Scripture and dates pass: a colon, comma,
  slash or letter ends a digit run ("John 3:16", "119:105"); a run of
  verse-sized numbers is allowed ("Psalms 23 27 91 121", "Rom 8.28-39"); a
  date-shaped run is allowed (10-02-2026, 2026-10-02). A run is a phone when
  it has a leading `+`, 7 or more contiguous digits, a group with a leading
  zero or above 176 (no chapter or verse is higher), or more than four
  single-digit groups. Comment errors say "Contact details are not allowed in
  comments" and never echo the input.
- **Blocklist:** `app/core/comment_blocklist.txt`, loaded once at import.
  Whole-word match on NFKC, confusable-folded, casefolded, accent-stripped
  text. Three line kinds: exact words and phrases; `+stem` profanity stems that
  also match their inflections as whole words (s, es, ed, ing, y, er, ers, a
  doubled final consonant, -y to -ies), so "shitting", "pussies", "bitchy",
  "motherfucking", "retarded" match while "assess", "class", "Scunthorpe" do
  not; and `!phrase` self-harm incitement matched with whitespace and
  punctuation collapsed and repeated letters squeezed ("killyourself", "kill ur
  self", "go dieee", "k y s"), still bounded by word boundaries at both ends so
  "ago diesel" does not fire. S11b added retarded, shitting, pussies, dicks,
  slut(s), dumbass, bitchy, motherfucking, nazi, and Isaac's onlyfans, nudes,
  kys, "go die". **Scripture-word exclusions:** `bastard, whore, damn, hell,
  cock, rape, porn, sex` (and `ass`) are deliberately **not** listed, since
  they occur in legitimate sermon discussion (Bible text, teaching on sin and
  judgment). Cost: some of these used as abuse pass the filter and rely on
  reports. A self-harm phrase is blocked even in a supportive sentence
  ("never kill yourself"); that is the pre-existing trade-off.
- **Reserved names (S11b, C-2):** a name whose first word, after
  normalisation, confusable folding and punctuation removal, is `pastor`,
  `admin`, `moderator`, `staff` or a variant is rejected, so a comment cannot
  read as "Pastor I.". Variants: pastors, pst, pr, ps; admins, administrator;
  moderators, mod; rev, revd, reverend; apostle, bishop, elder, deacon,
  deaconess, prophet, evangelist. Trailing digits ("Admin2") and spelled-out
  letters ("P a s t o r") are caught. Only the first word counts ("John
  Pastor" passes). Honorifics (mr, mrs, dr, brother, sister, minister) are not
  reserved.
- **Known residuals** (pinned in tests, accepted): spaced letters and
  leetspeak in profanity, "example . com", a bare `foo.me`, digits spelled out
  as words, and spaced two-digit groups that look like a scripture list
  ("12 34 56 78 90").
- **No body logging** at any level, including error paths. Bodies, names and
  report `detail` never reach logs. DB failures at write boundaries are
  rolled back, logged by exception class name only, and returned as a typed
  500 (no SQLAlchemy exception chained, since its `str()` embeds bound
  parameters). Covered by NL-01/02/04/06.

### 12. Moderation log: no FK

`comment_moderation_log` is append-only. `comment_id`, `sermon_id` and
`author_id` are **plain uuids with no FK**, so a log row outlives the comment
(self-delete and hard-delete remove it) and survives sermon/author deletion.
`actor_id` is FK `SET NULL` (null for `auto_hide`). Actions: `hide, restore,
hard_delete, self_delete, auto_hide, dismiss_reports`. CHECKs: `reason` not null for `hide`,
`hard_delete` and `dismiss_reports` (S11b); `body_snapshot` null unless
`hard_delete`; `cleared_report_count` (nullable integer, S11b) is set and
greater than 0 if and only if `action = 'dismiss_reports'`. Reason is
uncapped in the DB and capped at 300 chars in the request DTO
(`ModerationReason`, C2 deviation 4). The log holds ids and actions, not
bodies, apart from the 90-day snapshot.

### 13. CASCADE on erasure

`sermon_comments.user_id` and `sermon_comments.sermon_id` are FK `CASCADE`.
`sermon_comment_reports.comment_id` and `.reporter_id` cascade. `user_blocks`
cascades on both ends. Erasing a user erases their comments, reports and
blocks. `hidden_by_id` is `SET NULL`. This keeps the later account-deletion
work (App Store 5.1.1(v), out of scope, D11) from needing a comments pass.
The moderation log deliberately does not cascade (section 12), which is the
one place erasure leaves a trace; it holds no body after 90 days.

### 14. Endpoints (from S8's OpenAPI diff)

All under `/api/v1`, bearer auth, primary DB (`get_db`, never `get_read_db`).
`openapi.json` and both `schema.d.ts` files regenerated in S8.

**Removed (Notes, ADR 0012):** `/me/notes`, `/notes/{note_id}`,
`/sermons/{sermon_id}/notes`; schemas `NoteCreate`, `NotePublic`,
`NoteUpdate`.

**Added:**

| Method | Path | Result |
|---|---|---|
| GET | `/sermons/{sermon_id}/comments` | `Page[CommentPublic]`, limit 1-100 (25), offset; HIDDEN-of-others and blocked authors excluded from items and `total` |
| POST | `/sermons/{sermon_id}/comments` | 201 `CommentPublic` |
| DELETE | `/comments/{comment_id}` | 204 |
| POST | `/comments/{comment_id}/report` | 204 (self-report and duplicate are no-ops) |
| POST | `/comments/{comment_id}/block` | 200 `BlockCreated{id}` |
| GET | `/me/blocks` | `list[BlockPublic]` |
| DELETE | `/me/blocks/{block_id}` | 204 (404 unknown, others', repeat) |
| POST | `/me/comments-terms` | 204, idempotent |
| GET | `/admin/comments` | `?sermon_id&status&reported_only&needs_review&sort=recent\|most_reported&limit&offset`; `Page[CommentAdmin]` or `Page[CommentAdminForEditor]` |
| POST | `/admin/comments/{comment_id}/hide` | 200 `CommentAdmin`, body `{reason}`, idempotent |
| POST | `/admin/comments/{comment_id}/restore` | 200 `CommentAdmin`, idempotent |
| POST | `/admin/comments/{comment_id}/dismiss-reports` | 200 `CommentAdmin`, required body `{reason}` (1-300, `ModerationReason`), MANAGER and ADMIN; 409 if `HIDDEN`, 404 unknown, 422 without a valid reason |
| DELETE | `/admin/comments/{comment_id}` | 204, JSON body `{reason}`, ADMIN only |

**Changed:** `PATCH /auth/me` `{full_name}` added; `UserPublic` gains
`comments_terms_accepted_at`.

**Schemas added (14):** `BlockCreated, BlockPublic, CommentAdmin,
CommentAdminForEditor, CommentCreate, CommentPublic, CommentReportCreate,
CommentReportReason, CommentStatus, ModerationReason,
Page_CommentAdminForEditor_, Page_CommentAdmin_, Page_CommentPublic_,
ProfileUpdate`. (`OptionalModerationReason` existed briefly at S10b and was
removed in S11b when the reason became required.)

Admin sort: `hidden_auto DESC` is always the first key under both sorts, then
`report_count DESC` (most_reported), then `created_at DESC, id`. Hide and
restore return 200 with the row (not 204) so the portal updates without a
refetch. Hide of a manually hidden row and restore of a `VISIBLE` row are
no-ops with no log row.

**Dismiss reports (decided at C3, S7 deviation 4 resolved).** A moderator can
clear the reports on a still-`VISIBLE` comment without hiding it.
`POST /admin/comments/{id}/dismiss-reports` resets `report_count` to 0 and
changes nothing else: `status`, `hidden_*` and `hidden_auto` are untouched and
the author's label is unaffected (no "removed" label). It writes exactly one
`dismiss_reports` log row (actor, ids, reason, `cleared_report_count`) with
`clock_timestamp()` while holding the `FOR UPDATE` row lock, in the same
transaction. The row is a re-arm baseline like `restore`: the auto-hide count
considers only reports strictly after the latest `restore` or
`dismiss_reports` row. A `VISIBLE` comment with `report_count = 0` is a no-op
with no log row, but still requires a valid reason body (422 otherwise). A
`HIDDEN` comment returns 409 (use restore); an unknown id is 404. Check order matches hide and restore: 401, then 403 by role before any
lookup, then 422, then 404. **The reason is required** (S11b, SF-4, amending
the C3 contract: the first version made it optional): `ModerationReason`,
trimmed, normalised, 1-300 characters, same as hide and hard delete, so a
moderator cannot erase the report signal without a stated cause. The count of
reports cleared is recorded in `comment_moderation_log.cleared_report_count`.
Schema: in the unreleased revision `e5f6a7b8c9d0` (it has only run on
throwaway databases, so amended in place rather than adding a second revision)
the action CHECK was widened to include `dismiss_reports`; the reason-required
CHECK now also covers `dismiss_reports`; `cleared_report_count integer NULL`
was added with `ck_comment_moderation_log_cleared_count`
(`(action = 'dismiss_reports' AND cleared_report_count IS NOT NULL AND
cleared_report_count > 0) OR (action <> 'dismiss_reports' AND
cleared_report_count IS NULL)`).

### 15. Visibility and entitlement

Only `PUBLISHED` sermons past `publish_at` expose comments (rule lifted from
Notes into `visible_sermon_or_404`). Paid sermons require the same
entitlement as playback (`upgrade_required`, staff exempt); this check is new,
Notes never had it. Listing and posting on the sermon keep the 403, since the
sermon's existence is public. Report and block are by comment id, so for a
caller who is not entitled they return the same uniform 404 `Comment not
found` as an unknown id (S11b, SF-6), so the id of a comment on a paid sermon
cannot be probed. Login is required to read, post, or report.

---

## Pending C3/C4

Open at the time of writing. Do not treat as settled; each needs Isaac.

1. **URL TLD allow-list approach.** Built as an explicit allow-list so normal
   prose passes. Deviation from the plan's literal regex. Cost: a TLD missing
   from the list lets a link through. Isaac reviews the list and the approach.
2. **Blocklist exclusions.** The blocklist and the scripture-word
   exclusions in section 11 need Isaac's review at C4.
3. **`needs_review` filter as the badge mechanism.** The nav count is
   `GET /admin/comments?needs_review=true&limit=1`, reading `total`, instead
   of a count endpoint. `needs_review = hidden_auto OR (status = VISIBLE AND
   report_count > 0)`; role-scoped, so an editor's badge counts only their
   sermons. It differs from `reported_only` (`report_count > 0`, which also
   matches manually hidden rows). Smaller contract surface, but it is a
   fourth filter beyond the plan's three.

## Consequences

- **Positive:** Live immediately, with a bounded blast radius: three
  distinct reports hide a comment without staff. The App Store 1.2 floor is
  met by construction. Viewer DTOs carry no identity, so a client bug cannot
  leak a user id. Erasure cascades.
- **Negative:** Post-moderation means a harmful comment is visible to minors
  until reported (auto-hide needs 3 distinct reporters; staff queue is not
  real-time). Auto-hide is brigadable by 3 accounts; mitigated, not
  eliminated. Keyword, URL and contact filters are bypassable (leetspeak, spaced
  profanity, unlisted TLD, spelled-out digits). Rate limits fail open when Redis is down. `report_count`
  drifts when reporters are erased. Retaining a body for 90 days is a
  privacy cost, justified by abuse evidence.
- **Negative:** Public API contract change: Notes routes removed, 11 paths
  added, `PATCH /auth/me` added. Mobile typecheck fails until S13 removes
  Notes UI.
- **Neutral:** `ContentError` carries no machine code, so the client checks
  prerequisites (name set, terms accepted) proactively from `/auth/me`; the
  server's 403s are the backstop. Number is provisional; an Alembic merge
  migration may be needed at C5 (AM1.4 a).

## Alternatives considered

- **Pre-moderation (approve before visible):** rejected. Needs staff
  throughput we do not have; stalls every post. The auto-hide threshold and
  queue cover the risk.
- **Auto-hide off, queue only:** rejected given minors in the audience; a
  report storm would wait on a person.
- **Likes and Top sort (D2):** rejected. Adds a table, ranking and gaming
  surface for no stated need.
- **Nickname or "Member" fallback (D6):** rejected by Isaac. Anonymity weakens
  moderation and is wrong for a minors-present audience.
- **Block by user id:** rejected. Requires exposing author ids to clients,
  violating the DTO privacy rule.
- **Hide deactivated users' comments (D7):** rejected. Deactivation is an
  account control, not a content verdict; only explicit moderation removes
  content.
- **Keep snapshots on self-delete, or indefinitely:** rejected. Self-delete
  is a user privacy right; moderator snapshots are bounded to 90 days.
- **FK from moderation log to comments:** rejected. The log must outlive the
  comment it records.
- **Any 2+ letter run as TLD, or a blanket "contains a dot" URL rule:**
  rejected. Rejects ordinary prose ("Amen.Thank you", "John 3.16").
- **Blocklisting scripture-adjacent words:** rejected. Blocks legitimate
  sermon discussion; handled by reports instead.
- **Dedicated needs-review count endpoint:** rejected for a smaller contract
  surface (pending item 3).
