# ADR 0017 — Church settings: one typed row, an unauthenticated public read, mobile falls back

- **Status:** Proposed (flips to Accepted at `[HUMAN_GATE AS7]` merge to `dev`).
- **Date:** 2026-10-20
- **Scope:** Backend — the `church_settings` table (migration `e5a68425e539`), the `ChurchSettings`
  model, `app/services/settings_service.py`, `app/api/admin_settings.py`
  (`GET /settings/public`, `GET/PATCH /admin/settings`) and their DTOs. Mobile — the
  `useChurchSettings()` read and its fallback (S18). Admin portal — the `/settings/profile`
  screen (S17).
- **Deciders:** Isaac (+ planner, architect, senior-dev-backend)
- **Relates to:** `plans/plan-admin-settings.md` §A.1 (D2, D2a, D3, D7), §A.4.3, §A.5;
  ADR 0018 (the `settings.updated` audit row).

> Managers and admins edit the church profile and the content the mobile app shows; the app reads
> it without signing in and keeps working offline with the values it ships with.

---

## Context

Contact email and comment guidelines were hard-coded in the mobile app
(`mobile/lib/content/commentsCompliance.ts`), so changing either meant an app-store release. The
terms of use and privacy policy had no home at all. The settings had to be:

1. **Editable by staff** without a deploy, and safe against two editors saving at once.
2. **Readable by a signed-out app**, because comment guidelines and the legal links are shown
   before or without an account, and cheap enough that every app launch can ask.
3. **Never a reason the app breaks**: first launch with no network, a backend outage, or an
   older app talking to a newer server must still show sensible text.

## Decision

### 1. One typed row, not a key/value store

`church_settings` has named, typed columns and exactly one row: `id SMALLINT PRIMARY KEY
CHECK (id = 1)`. The migration seeds it with the values the app already shipped (church name,
app name, `contact@rhemapod.com`, and `comment_guidelines` byte-for-byte equal to
`COMMENTS_TERMS_TEXT`; a test re-reads the TS file so the two can't drift silently). Nothing
inserts at runtime. `updated_by_id` has no FK, so erasing an account never touches the row.

### 2. Optimistic concurrency on `version`

`PATCH /admin/settings` is a partial update that must carry the `version` the editor loaded. The
write is `UPDATE … WHERE version = :v` and bumps it; zero rows updated is a 409 ("reload and
reapply"), never a silent overwrite. Only fields whose value actually changes are written; a
request that changes nothing doesn't bump the version or write an audit row. The audit row
(`settings.updated` with `changed`/`before`/`after`) is in the same transaction (ADR 0018).
Managers and admins may edit (D7).

### 3. An unauthenticated public read, cached and validated

`GET /settings/public` needs no token and returns everything except `updated_by_id`/`updated_at`.
It is served through Redis cache-aside (`settings:public:v1`, 300 s, fail-open: a Redis outage
costs one DB read). The response carries `ETag: W/"<version>"` and
`Cache-Control: public, max-age=300`; a matching `If-None-Match` gets a bodiless 304. This is the
first weak ETag in the API. PATCH deletes the cache key after commit; if that delete fails, the
TTL bounds staleness. Both reads use the primary DB, so a lagging replica can't re-cache the old
row right after an edit.

### 4. Legal documents are links; guidelines are text (D2, D2a, D3)

The privacy policy and terms of use are hosted by Isaac elsewhere and stored as `https` URLs
only, with no in-app rendering. Comment guidelines stay inline text because viewers accept them
in-app before their first comment. Editing the guidelines does **not** force re-acceptance:
`users.comments_terms_accepted_at` stands, and `audit_log` is the only record of what changed
when.

### 5. Mobile falls back to what it ships with

The app reads the public settings through TanStack Query with the existing persisted cache. When
there's no network, the request fails, or it's the first launch, it uses the
`commentsCompliance.ts` constants. The Terms and Privacy rows only appear when their URL is set.
`about`, `tagline`, `contact_phone`, `website_url` and `address` are returned but not rendered in
v1.

## Consequences

- **Positive:** contact details, guidelines and legal links change without an app release. Two
  concurrent editors can't lose each other's work. The public read is cheap for the server
  (cache + 304) and the client (ETag), and the app never shows an empty screen because of it.
- **Negative / accepted:** the public endpoint exposes the church's contact details to anyone,
  which is the point, but means nothing private may ever be added to `ChurchSettingsPublic`.
  After an edit, a client may show the old values for up to 300 s (the `max-age`). Viewers who
  accepted older guidelines aren't shown the new ones unless they reopen the sheet (D3).
- **Follow-ups:** S17 (portal screen), S18 (mobile read + rows). The privacy policy Isaac hosts
  should cover what ADR 0018 and 0019 collect.

## Alternatives considered

- **Key/value settings table:** rejected. Every field would need its own validation and type
  coercion in code, migrations couldn't express NOT NULL or lengths, and "which keys exist?"
  becomes runtime state.
- **Last-write-wins PATCH:** rejected. Two managers editing the guidelines at once would silently
  drop one person's changes.
- **Authenticated settings read:** rejected. Guidelines and legal links are needed before sign-in,
  and an auth requirement would add a token refresh to every app launch for public information.
- **Rendering the legal documents in-app:** rejected by Isaac (D2). The documents live with their
  owner and change on their own schedule.

---

## Addendum 1 (2026-10-30): comment guidelines become a code-sourced public document

- **Status:** Proposed (flips to Accepted at `[HUMAN_GATE P4]`). The text above is unchanged.
- **Deciders:** Isaac (chat, 2026-10-30; `[HUMAN_GATE GA0]` passed) (+ planner, scribe)
- **Relates to:** `plans/plan-ad5-amendment-1-guidelines.md` §G.1-§G.7 and the GA0 decisions at
  its end; `plans/plan-ad5-retention-and-legal-pages.md` (base plan, P2 answer 7).

### What is reversed
- **§1 (seed row):** `comment_guidelines` is no longer a column of the settings row. The
  `e5a68425e539` seed stays as history.
- **§4 ("guidelines are text", staff-editable):** the guidelines are still text, but staff no
  longer edit them. They are a public legal document whose text lives in the backend repo, and
  the admin-portal editor is removed (§G.5). Reverses P2 answer 7 (option b) for guidelines only.
  `terms_of_use_url` and `privacy_policy_url` are unchanged.

### Decisions
1. **Source file (§G.1).** `app/content/comment_guidelines.txt` is the only editable source.
   `app/content/__init__.py` loads it once at import (a missing or empty file fails startup) and
   exposes `COMMENT_GUIDELINES` and `COMMENT_GUIDELINES_DIGEST` (first 12 hex chars of the
   SHA-256 of the UTF-8 bytes). `.txt`, not `.md`: `.dockerignore` excludes `*.md` (the file
   would be missing from the API image), and mobile `TermsSheet` renders the text verbatim, so
   Markdown syntax would show up literally. The file ends with one `\n`, which the loader strips.
   Mobile `COMMENTS_TERMS_TEXT` must equal the loaded string byte for byte; a backend test pins
   it.
2. **"Last updated" line (GA0 decision 2).** The file carries a "Last updated: <date>" line, so
   the `/guidelines` page and the app show the same date from one copy. The mobile constant and
   the pin test change with it. A text change is one commit that edits the file and
   `mobile/lib/content/commentsCompliance.ts` together.
3. **PATCH returns 422 (§G.2).** `comment_guidelines` is removed from `ChurchSettingsUpdate`,
   `SETTINGS_TEXT_FIELDS` and `SETTINGS_REQUIRED_FIELDS`. `extra="forbid"` already yields FastAPI's
   `extra_forbidden` 422. Ignoring the field was rejected: a stale portal tab would get a 200 for
   an edit that never happened. Response shapes keep `comment_guidelines: str`, now filled from
   the file, so the OpenAPI response contract is unchanged. This is a public contract change
   (reviewed at `[HUMAN_GATE GA1]`).
4. **ETag and cache key (§G.2).** The public ETag becomes `W/"<version>-<digest>"` and
   `etag_matches` compares the full opaque tag, so a client holding `W/"1"` cannot get a 304 for
   a body whose guidelines changed in a deploy. The Redis key becomes
   `settings:public:v2:<digest>`; orphaned v1 keys expire on their 300 s TTL. Clients treat the
   ETag as opaque (RFC 9110); none parses it. `version` in the body keeps its meaning (the row's
   optimistic-concurrency token).
5. **Column drop (§G.3).** A new Alembic revision (`down_revision = d9e0f1a2b3c4`) drops
   `church_settings.comment_guidelines`. It is destructive, by Isaac's choice, and guarded:
   upgrade raises `RuntimeError` if the stored text differs from a frozen `_CANONICAL` copy in the
   migration (migrations do not import app code), so staff edits are never destroyed silently.
   Downgrade re-adds the column nullable, fills `_CANONICAL`, then sets `NOT NULL`, with no
   `server_default`, matching `e5a68425e539`. Downgrade restores canonical text, not any earlier
   edit; the guard guarantees there was none. If staff edited the Render dev row, the original
   text stays in the file and the dev row is reset to it before the migration runs (GA0
   decision 3, GA1 pre-check).
6. **Public page (§G.4).** `/guidelines` on the admin portal fetches `GET /settings/public`
   server-side at request time (not build time), without credentials, caches success for at most
   1 hour, and shows fallback copy on failure.
7. **Change record (§G.1).** Git is the record of what changed and when. `audit_log`
   `settings.updated` no longer covers guidelines; historic rows listing `comment_guidelines` in
   `changed` stay (append-only).
8. **Acceptance unchanged (§G.7, GA0 decision 1).** `users.comments_terms_accepted_at` stays a
   single nullable timestamp. Editing the file never forces re-acceptance, and the digest is not
   stored per user. Git history now reconstructs the text in force at any acceptance time. If a
   change ever needs re-acceptance, a reviewed one-off
   `UPDATE users SET comments_terms_accepted_at = NULL` does it, as its own gate. Versioned
   acceptance is a possible follow-up.

### Consequences
- Positive: one source for API, portal page and mobile fallback, guarded by two pin tests; an
  exact text-per-date history in git; no staff path to edit legal text.
- Negative: wording changes need a deploy, not an admin click. The migration is destructive and
  can crash-loop Render boot if the dev row was edited (mitigated by the GA1 pre-check). The
  third text copy (`_CANONICAL`) is pinned only while the file is unchanged; the first real text
  edit must rewrite that test against a git-pinned constant (§G.3). A stale portal tab saving
  Settings during the deploy gets a 422. `/guidelines` depends on API uptime (1 hour cache plus
  fallback copy).
- Neutral: `GET /settings/public` and `GET /admin/settings` shapes are unchanged; the ETag string
  format changes.

### Alternatives considered
- **Keep it staff-editable (ADR above):** reversed by Isaac; the guidelines are now a legal
  document, so edits go through review.
- **Markdown file or build-time portal import:** rejected. `.dockerignore` drops `*.md`, the
  portal builds from `rootDir: admin_portal` and cannot read `../app/content`, and a build-time
  API fetch couples `next build` to API uptime (§G.1, §G.4).
- **Ignore the field on PATCH (200):** rejected, see decision 3.
- **Store a digest per acceptance now:** deferred; not needed to meet this amendment (§G.7).
