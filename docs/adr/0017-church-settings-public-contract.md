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
