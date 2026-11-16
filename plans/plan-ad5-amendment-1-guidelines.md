# Plan amendment 1 to AD5: comment guidelines become a public legal document

**Amends:** `plans/plan-ad5-retention-and-legal-pages.md` (the "base plan"). The base plan is
immutable. This file adds to it and supersedes the specific sections named below. Every other
part of the base plan stays binding.

**Decision:** Isaac, in chat, 2026-10-30. Comment guidelines become a public legal document, and
the admin-portal editor is removed. This reverses P2 answer 7 (option b) and ADR 0017 for
guidelines only.

**Supersedes in the base plan:**
- §B.2, all of it. Replaced by §G.1–§G.6 below.
- P2 answer 7. The guidelines are now a public page whose text is sourced from code, not from
  staff edits.
- §B.1's "no data fetching" rule, **for `/guidelines` only** (§G.4).
- These DoD lines: "There is **no** public `/guidelines` page", "ADR 0017 is unchanged", and "No
  schema change is expected" in the preamble.
- L2's "`/guidelines` is not a route" test. G6 flips it.
- L4's "No ADR 0017 change". G1 replaces it.
- L5's security scope. It is extended in §G.7.
- The Constraints line "Admin-editable legal text is not in scope". Guidelines stop being
  admin-editable, so nothing admin-editable is added.

Logging follows the base plan: root `status.md`, prefix `AD5-PREREQ`, one
`## AD5-PREREQ — <step> <agent: …> <date>` heading per step. Branch, commit style, test commands
and the no-new-dependencies rule are inherited unchanged.

**Starting state** (planner, worktree `feat/ad5-retention-legal` @ `e001686`): L2 is committed.
L3 is in progress, editing `admin_portal/app/(public)/{privacy,terms,support}` and
`legal-section.tsx`. The Alembic head is `d9e0f1a2b3c4`.

---

## Goal

The comment guidelines live in one text file in the backend repo. `GET /settings/public` serves
that file's text on its existing `comment_guidelines` field. A public `/guidelines` page on the
admin portal shows the same text. The portal editor is gone, and `church_settings.comment_guidelines`
is dropped by a reviewable, reversible Alembic migration. The mobile fallback constant is pinned
byte-for-byte to the file.

## Definition of Done (added to the base plan's DoD)

- [ ] `app/content/comment_guidelines.txt` is the only editable source of the guidelines text.
      The backend loads it once at import. A missing or empty file fails startup.
- [ ] `GET /settings/public` and `GET /admin/settings` still return `comment_guidelines: string`,
      with the same shape, and the value comes from the file. When the text changes, the ETag
      changes too, even if the row `version` doesn't.
- [ ] `PATCH /admin/settings` with `comment_guidelines` returns **422**.
- [ ] Migration `<new>` drops `church_settings.comment_guidelines`. Its upgrade aborts if the
      stored text differs from the canonical text. Its downgrade restores the column as
      `TEXT NOT NULL`, holding the canonical text. Upgrade → downgrade → upgrade round-trips are
      tested on real Postgres.
- [ ] A backend test pins `COMMENTS_TERMS_TEXT` (mobile) == the file, byte for byte.
- [ ] Portal Settings has no guidelines field.
- [ ] Public `/guidelines` renders the API text. It caches for at most 1 hour, falls back
      gracefully, and never fails `next build`. It is in `LegalNav` (five links), and the Terms
      link to it.
- [ ] ADR 0017 has an addendum recording the reversal.
- [ ] `[HUMAN_GATE GA1]` is crossed before Part B merges (P4).

---

## Part G — design (binding)

### G.1 Source of truth: `app/content/comment_guidelines.txt`
- **Location:** the new `app/content/` package holds static, versioned text that the API serves.
  It isn't config (`app/core`), it isn't logic (`app/services`), and it isn't a model.
  `app/content/__init__.py` exposes `COMMENT_GUIDELINES: str` and
  `COMMENT_GUIDELINES_DIGEST: str` (the first 12 hex characters of the SHA-256 of the
  UTF-8 bytes).
- **Why `.txt` and not `.md`:**
  1. `.dockerignore` excludes `*.md`, so a `.md` file would be missing from the API image and
     the app would fail at boot on Render.
  2. The text is plain text, not Markdown. Mobile `TermsSheet` renders it verbatim, splitting the
     first line off as the title. A `.md` extension would invite syntax that shows up literally
     in-app.
- **Bytes:** UTF-8. The file ends with exactly one `\n` (POSIX; editors add one), and the loader
  strips exactly one trailing `\n`. The resulting string must equal `COMMENTS_TERMS_TEXT`, which
  has no trailing newline. Load the file with `Path(__file__).with_name(...)`. No
  `importlib.resources` dependency question arises.
- **Initial content:** the current `COMMENTS_TERMS_TEXT`, verbatim. That is also the seed in
  `e5a68425e539`. Any text change is a separate decision and a commit that edits the file and
  `mobile/lib/content/commentsCompliance.ts` together. The pin test enforces this.
- **Change history:** git is now the record of what changed and when. `audit_log`
  `settings.updated` no longer covers guidelines. Historic rows that list `comment_guidelines` in
  `changed` stay as they are; `audit_log` is append-only.

### G.2 API contract
- **`ChurchSettingsPublic` / `ChurchSettingsAdmin`:** `comment_guidelines: str` stays in the
  response models. `settings_service._to_public` sets it from `COMMENT_GUIDELINES`, not from the
  row. The OpenAPI response shape doesn't change.
- **`ChurchSettingsUpdate`:**
  - The field is removed.
  - It is also removed from `SETTINGS_TEXT_FIELDS` and from `SETTINGS_REQUIRED_FIELDS`, which
    becomes `("contact_email",)`.
  - `model_config = ConfigDict(extra="forbid")` already exists, so a PATCH carrying the field
    gets FastAPI's standard 422 (`extra_forbidden`) with no new code.
- **Why 422 and not ignore:**
  - It matches the existing `extra="forbid"` posture.
  - With ignore, a stale portal tab would get a 200 for an edit that never happened, which is a
    silent lie to a staff user.
  - The only client that sends this field is the portal, which deploys from the same `dev`
    merge. Blast radius: one open tab during a deploy.
  - This is a public API contract change, so it is gated at `[HUMAN_GATE GA1]`.
- **ETag and cache:**
  - The public ETag becomes `W/"<version>-<COMMENT_GUIDELINES_DIGEST>"`, and `etag_matches`
    compares the full opaque tag. Otherwise a client holding `W/"1"` would get 304 for a body
    whose guidelines changed in a deploy.
  - The Redis key becomes `settings:public:v2:<digest>`, so a deploy never serves a body cached
    under the old text. Orphaned v1 keys expire on their 300 s TTL.
  - The ETag format is opaque per RFC 9110, and no client parses it: mobile sends no explicit
    `If-None-Match`, and the portal reads the admin endpoint. It is still recorded in the ADR and
    reviewed at GA1.
- **Unchanged:** `version` in the body keeps its meaning, the row's optimistic-concurrency
  token.

### G.3 Migration: drop `church_settings.comment_guidelines`
- **Revision:** a new file, `down_revision = "d9e0f1a2b3c4"`. If the head has moved when G3
  runs, halt; the Conductor re-points it.
- **Frozen text:** `_CANONICAL` is the guidelines text copied verbatim into the migration file.
  Migrations must not import app code, because app code changes and migrations must not. A test
  asserts `_CANONICAL == COMMENT_GUIDELINES`, but only while the file is unchanged. If the text is
  ever edited later, that test is deliberately rewritten to compare against the git-pinned
  constant (G3 records this in the test's docstring).
- **upgrade():**
  1. `SELECT comment_guidelines FROM church_settings WHERE id = 1`.
  2. If a row exists and its value `!= _CANONICAL`, raise `RuntimeError`, naming the mismatch.
     Don't print the text. Staff edits would otherwise be destroyed silently, so the migration
     refuses, and the operator reconciles first (GA1 pre-check).
  3. `op.drop_column("church_settings", "comment_guidelines")`.
- **downgrade():** in three statements, so the column comes back exactly as `e5a68425e539`
  created it, with no `server_default`:
  1. `add_column(... Text, nullable=True)`;
  2. `UPDATE church_settings SET comment_guidelines = :canonical`;
  3. `alter_column(... nullable=False)`.

  Downgrade restores the canonical text, not any earlier staff edit. The upgrade guard
  guarantees there was none.
- **Additive?** No. This is a destructive column drop, as Isaac chose. It is reviewable: one
  file, a guard, and a symmetric downgrade.
- **Data transfer:** `data_transfer_service` builds columns from `Base.metadata`, so exports stop
  including the column automatically. An older export already fails import on the
  `schema_revision` mismatch (any migration does that), so no service code changes. G3 confirms
  this with a test run of `tests/test_admin_data.py`. A code change here is a divergence: halt.
- **Render:** `scripts/render-start.sh` runs `alembic upgrade head` on boot. A guard failure there
  is a crash loop, which is why the GA1 pre-check is mandatory.

### G.4 Public `/guidelines` page
- **Route:** `admin_portal/app/(public)/guidelines/page.tsx`. It is a server component, with no
  session and no `cookies()` or `headers()`, built from the base plan's shell (`Wordmark`,
  `LegalNav`, `metadata` title "Community Guidelines").
- **Data source: request time, not build time.** It does a server-side
  `GET ${API_BASE_URL}/api/v1/settings/public` with no credentials and no forwarded headers, and
  caches a success for at most 3600 s. Why not build time:
  1. Render builds the portal with `rootDir: admin_portal`, so it can't safely read
     `../app/content`, and backend-only commits don't redeploy it.
  2. A build-time API fetch couples `next build` to API uptime.

  Request time keeps the base plan's original server-sourced design. Next 16.4: read
  `node_modules/next/dist/docs/` for the current fetch-cache or `use cache` / `cacheLife` API
  before choosing (`admin_portal/AGENTS.md`).
- **Behaviour:**
  - On success, render the first line as `<h1>` (same split as mobile `splitTerms`), and the rest
    as paragraphs split on blank lines, with `•` lines kept as list items. React text nodes only:
    no `dangerouslySetInnerHTML`, no Markdown parser, no new dependency.
  - On a network error, a non-2xx response or a missing or empty field, render a fallback: "The
    community guidelines can't be loaded right now. They're also shown in the RhemaPod app before
    you first comment." plus contact@rhemapod.com. Keep the 200 status and the nav.
  - A failure must not be cached for more than 60 s.
  - `next build` must succeed with the API unreachable.
- **No effective-date line** on `/guidelines`. The text is server-sourced, and a portal-side
  date would be a second copy that drifts. Git history is the version record. See the open
  question at the end.
- **`LegalNav`** gets five links: `/privacy`, `/terms`, `/guidelines`, `/support`,
  `/delete-account`.
- **Terms:** the guidelines sentence (L3) links `/guidelines` ("Community Guidelines, also shown
  in the app before you first comment"). The text isn't copied into the Terms.

### G.5 Admin portal Settings
- The "App content" section loses the `comment_guidelines` field and its `draft.comment_guidelines`
  submit guard. `use-church-settings.ts` drops it from the editable-fields list and its comment.
- A one-line, read-only note replaces the field: "Comment guidelines are a public document at
  /guidelines. Changes are made in the app's source, not here." No new component.
- The `terms_of_use_url` / `privacy_policy_url` fields stay.

### G.6 Mobile
- `TermsSheet`, `useChurchContent` and the Legal-row behaviour (L4) don't change.
- `mobile/lib/api/schema.d.ts` is regenerated, so `comment_guidelines` disappears from the
  Update type only.
- These doc comments are updated, and nothing else:
  - `commentsCompliance.ts`: "the server row was seeded from these exact values" becomes "these
    equal `app/content/comment_guidelines.txt`; a backend test pins them".
  - `useChurchSettings.ts`: "editable by staff" becomes "contact email and links editable by
    staff; guidelines from the backend's text file".

### G.7 Terms acceptance and versioning (investigated; no change in this amendment)
- **How it works today:**
  - `users.comments_terms_accepted_at` is a single nullable timestamp (`app/models/models.py`
    ~L126).
  - `comments_service.accept_terms` (~L561) sets it once, idempotently: `WHERE ... IS NULL`.
  - `create_comment` (~L305) only checks `IS NULL`.
  - Nothing records which text was accepted. ADR 0017 §4 says explicitly that editing the
    guidelines does **not** force re-acceptance.
- **Under this amendment:** this is unchanged. A wording change in the file never prompts anyone
  again. Git now gives an exact text-per-date history, so "what was in force when user X
  accepted at T" can be reconstructed. Under ADR 0017 it couldn't (the audit diff only).
- **If a change ever needs re-acceptance:** the existing mechanism already supports it. A
  reviewed one-off, `UPDATE users SET comments_terms_accepted_at = NULL`, makes everyone
  re-accept on their next comment, and the mobile `CommentsPanel` already prompts on `null`.
  That one-off would be its own data-change gate. Versioned acceptance (storing a digest) is a
  follow-up, not this amendment.
- **L5 security scope addition:** `/guidelines` is the one public page that fetches. Verify that
  it fetches server-side only, sends no credentials or cookies, renders text without HTML
  injection, and sets no cookies.

---

## [HUMAN_GATE GA0] — Amendment approval
Isaac approves this amendment, including §G.1–§G.7, the 422 choice, the ETag format, and the
upgrade guard. Nothing in Part G runs before this. L3 may keep running; it doesn't depend on
Part G.

### G1 — ADR 0017 addendum (Proposed)
- **Owner agent:** scribe
- **What:** Append "Addendum 1 (2026-10-30): comment guidelines become a code-sourced public
  document" to `docs/adr/0017-church-settings-public-contract.md`. It covers:
  - the reversal of §1's seed and §4's "staff-editable";
  - the source file (§G.1) and the `.txt` rationale;
  - PATCH → 422 (§G.2);
  - the ETag `W/"<version>-<digest>"` and Redis key v2;
  - the column drop and downgrade (§G.3);
  - git as the change record;
  - acceptance unchanged (§G.7).

  Status: Proposed. It flips to Accepted at `[HUMAN_GATE P4]`. The original ADR text isn't
  edited.
- **Files / scope:** `docs/adr/0017-church-settings-public-contract.md` (append only).
- **Verification:** `git diff` shows additions only below the existing text. Every claim cites a
  §G section.
- **Commit:** `docs(adr): 0017 addendum, comment guidelines sourced from code`
- **Status update:** `[G1] <addendum heading, status>`

### G2 — Backend: file source of truth + contract
- **Owner agent:** senior-dev-backend
- **What:** Implement §G.1 and §G.2, with **no migration** in this step:
  - The ORM `ChurchSettings` stops mapping `comment_guidelines`, and its docstring is updated.
    The DB column becomes orphaned until G3. That's harmless, because nothing inserts at runtime
    and tests use `create_all`.
  - Update the fixtures that construct `ChurchSettings(comment_guidelines=...)`:
    `tests/test_church_settings.py`, `tests/test_admin_cleanup.py` ~L290.
  - The pin test replaces `_guidelines()`. It asserts:
    1. `COMMENT_GUIDELINES == COMMENTS_TERMS_TEXT`, extracted with the existing regex and the
       no-escape/no-interpolation assertion;
    2. the file ends with exactly one `\n`;
    3. the first line is "RhemaPod Comment Guidelines".
  - Update the router module docstring.
- **Files / scope:** `app/content/{__init__.py,comment_guidelines.txt}`,
  `app/models/{models.py,content_schemas.py}`, `app/services/settings_service.py`,
  `app/api/admin_settings.py` (docstring only), `tests/test_church_settings.py`,
  `tests/test_admin_cleanup.py`. Leave `tests/test_audit_log.py` alone: its `"comment_guidelines"`
  string is opaque JSONB data.
- **Verification:**
  - Tests: GET public returns the file text. GET admin returns it. PATCH with the field → 422.
    PATCH without it still works and bumps the version.
  - The ETag equals `W/"1-<digest>"`, and 304 works on the full tag. A stale `W/"1"` gets a 200.
    Monkeypatching the digest changes the ETag and the Redis key.
  - The pin test passes, and it fails if one byte of either side changes (proven locally by a
    temporary edit, not committed).
  - The full backend suite is green.
- **Commit:** `feat(settings): comment guidelines served from app/content, PATCH no longer accepts them`
- **Status update:** `[G2] <test counts, ETag sample>`

### G3 — Migration: drop the column
- **Owner agent:** senior-dev-backend
- **What:**
  - Write the migration in §G.3.
  - Update `tests/test_migrations_admin_settings.py`:
    - The head-shape round trip no longer expects `comment_guidelines`.
    - The seed-row test runs at `_CHURCH_SETTINGS_REVISION` (`e5a68425e539`), not at head, and
      still pins the seed byte-for-byte against the mobile constant.
    - The second-row CHECK/UNIQUE inserts drop the column at head.
  - Add new tests:
    1. Upgrade to head: the column is gone.
    2. Downgrade one step: the column is `text NOT NULL`, with no default, holding `_CANONICAL`.
       Re-upgrade succeeds.
    3. At `d9e0f1a2b3c4`, `UPDATE ... SET comment_guidelines = 'edited'`, then upgrade raises,
       and the column still exists.
    4. `_CANONICAL == COMMENT_GUIDELINES`.
  - Run `tests/test_admin_data.py` unchanged.
- **Files / scope:** `alembic/versions/<rev>_drop_church_settings_comment_guidelines.py`,
  `tests/test_migrations_admin_settings.py`.
- **Verification:**
  - The tests above are green on Testcontainers Postgres.
  - `uv run alembic heads` shows exactly one head.
  - The full backend suite is green.
- **Commit:** `feat(db): drop church_settings.comment_guidelines (guarded; downgrade restores canonical text)`
- **Status update:** `[G3] <revision id, test counts>`

### G4 — Backend review
- **Owner agent:** reviewer-gilfoyle + security-reviewer (parallel), then briefer
- **What:**
  - Gilfoyle: G2 and G3. Check the guard, downgrade symmetry, ETag/cache-key correctness, no
    import of app code in the migration, and the pin test's strength.
  - Security: the public endpoint exposes nothing new. The 422 path leaks nothing. The file load
    can't be path-steered.
  - Briefer: compresses the findings, the migration file, and the before/after OpenAPI diff for
    GA1.
- **Files / scope:** read-only. Fixes are committed as `fix(...)`.
- **Verification:** no open BLOCKER or HIGH. The backend suite is green on the head.
- **Status update:** `[G4] <verdicts>`

## [HUMAN_GATE GA1] — Migration + public API contract review (before any merge to `dev`)
Isaac reviews the G3 migration (guard, drop, downgrade), the PATCH 422 contract change, the ETag
format change, and the ADR 0017 addendum.

**Mandatory pre-check, executor on Isaac's approval, read-only:** run
`SELECT comment_guidelines FROM church_settings` on Render dev and compare it to the file.
- If they're equal, the guard passes on deploy.
- If they differ, staff edited it. Isaac chooses either (a) to put the edited text in the file
  and the mobile constant (a new G2 commit, so G3's `_CANONICAL` must match), or (b) to reset the
  dev row to the canonical text. Either way, decide before P4. Don't bypass the guard.

Crossing GA1 authorises the contract and migration to ride the base plan's `[HUMAN_GATE P4]`
merge. It doesn't merge anything itself.

### G5 — Portal Settings + OpenAPI regen
- **Owner agent:** senior-dev-frontend (portal); mobile-developer (mobile schema + comments, a
  separate commit)
- **What:**
  - Regenerate `openapi.json` from the G2/G3 head, then run `npm run gen:api` in `admin_portal/`
    and `mobile/`.
  - Portal: implement §G.5, and update `tests/settings/settings-screens.dom.test.tsx` and
    `settings-hooks.test.ts`, keeping the fixture's `comment_guidelines`, since responses still
    carry it.
  - Mobile: implement the §G.6 comment-only edits.
- **Files / scope:** `openapi.json`, `admin_portal/lib/api/schema.d.ts`,
  `admin_portal/components/settings/profile-screen.tsx`,
  `admin_portal/lib/query/hooks/use-church-settings.ts`, `admin_portal/tests/settings/*`,
  `mobile/lib/api/schema.d.ts`, `mobile/lib/content/commentsCompliance.ts` (comment only),
  `mobile/lib/query/hooks/useChurchSettings.ts` (comment only).
- **Verification:**
  - A portal DOM test shows no guidelines input and the read-only note present. A save sends no
    `comment_guidelines`.
  - Portal `npm run verify` is green.
  - Mobile `npx tsc --noEmit && npx jest` are green, with `TermsSheet` tests untouched and
    passing.
- **Commits:** `feat(portal): remove comment guidelines editor from Settings`,
  `chore(mobile): regenerate API types; guidelines source comments`
- **Status update:** `[G5] <counts>`

### G6 — Public `/guidelines` page + nav + Terms link (after L3 is committed)
- **Owner agent:** senior-dev-frontend
- **What:**
  - Implement §G.4.
  - Flip L2's test to "`/guidelines` exists under `app/(public)`", keeping the assertions that no
    `(portal)` or root `guidelines` route exists.
  - `LegalNav` tests expect five links.
  - Add the Terms link sentence.
  - G6 can start once G2 is committed (the public read is unchanged), independent of GA1. It must
    start **after** L3's commit, so it doesn't collide with L3's edits to `terms/page.tsx` and
    the legal tests.
- **Files / scope:** `admin_portal/app/(public)/guidelines/page.tsx`,
  `admin_portal/app/(public)/_components/legal-nav.tsx`, `admin_portal/app/(public)/terms/page.tsx`
  (one sentence and link), `admin_portal/tests/public/legal-pages.dom.test.tsx`, and a new
  `admin_portal/tests/public/guidelines.dom.test.tsx`.
- **Verification:**
  - DOM tests:
    - On fetch success, the h1 is the first line and the bullets render. The page has no
      `PENDING`/`TODO`/`DRAFT`.
    - On a fetch rejection, the fallback renders without throwing.
    - On a 200 with an empty field, the fallback renders.
    - The request carries no `cookie` or `authorization` header.
  - `npm run verify` is green, **with `API_BASE_URL` pointed at a closed port** (the build must
    not fail).
- **Commit:** `feat(portal): public community guidelines page`
- **Status update:** `[G6] <counts, build-with-API-down result>`

### Then, the base plan resumes
- **L4:** runs as written, minus "No ADR 0017 change". The mobile "Community guidelines" row
  still opens the in-app sheet.
- **L5:** the scope adds G5, G6, and the §G.7 security check on `/guidelines`.
- **`[HUMAN_GATE P3]`:** Isaac also reads `/guidelines`. The text is unchanged, but the page,
  the fallback copy and the Terms link are new.
- **`[HUMAN_GATE P4]`:** has extra preconditions and extra post-deploy checks.
  - Preconditions: GA1 is crossed, and the GA1 pre-check is resolved.
  - Post-deploy check 1: the Render boot log shows the new revision applied, with no guard error.
  - Post-deploy check 2: `GET /settings/public` still has `comment_guidelines`, and the ETag has
    the `-<digest>` form.
  - Post-deploy check 3: a PATCH carrying the field returns 422.
  - Post-deploy check 4: `/guidelines` loads signed out on a phone.
  - On approval, ADR 0017 Addendum 1 flips to Accepted.

## Rollback (added to the base plan's)
- **G5 and G6:** revert the commits. They are additive pages and UI.
- **G2 and G3 before P4:** revert on the branch. Nothing has been deployed.
- **G2 and G3 after P4:** first run `alembic downgrade -1` on Render dev, as its own step; the
  column returns with the canonical text. Then revert G3, G2 and G5, and redeploy. Order matters:
  the reverted ORM maps a NOT NULL column, so the downgrade must run before the old code boots.
  This is lossless, because the guard guaranteed the dropped value was the canonical text.

## Risks
- **Guard crash loop on Render:** this happens if the GA1 pre-check is skipped and the dev row
  was edited. Mitigation: the mandatory pre-check. The fix if it happens anyway is to reset the
  row to canonical (`UPDATE`), not to edit the migration.
- **Text drift across three places** (the file, the mobile constant, the frozen migration
  constant): pinned by two tests. The third pin is deliberately rewritten on the first real text
  change (§G.3).
- **`/guidelines` depends on API uptime:** mitigated by the 1-hour cache and the fallback copy.
  The in-app copy has its own offline fallback.
- **No re-acceptance on wording changes:** unchanged from today (§G.7). A future material change
  needs its own decision.

---

## [HUMAN_GATE GA0] — PASSED 2026-10-30 (Isaac, chat: "GA0 approved")
Decisions on the open questions:
1. Re-acceptance: no change — editing the guidelines never re-prompts; git history is the record of text in force. Versioned acceptance stays a possible follow-up.
2. Effective date: put a "Last updated: <date>" line inside `app/content/comment_guidelines.txt` (so the page and app both show it). The mobile `COMMENTS_TERMS_TEXT` fallback and the byte-for-byte pin test change accordingly.
3. If the dev row's text was edited by staff: the ORIGINAL text stays (the file holds the original; reset the dev row to the original before GA1's migration so the guard passes).
