# ADR 0022: Daily devotional public contract and listener-local dates

- Status: Proposed (awaiting `[HUMAN_GATE DV2]`)
- Date: 2026-11-09
- Deciders: Nii (+ planner)
- Plans: `plans/plan-daily-devotional.md`
- Relates to: ADR 0017 (church settings public contract)

> A devotional belongs to a calendar date, not an instant. The app asks for its own local date;
> the server bounds the date to a window, falls back to an evergreen pool, and never stores
> "published" as a state.

## Context

- Listeners are in many time zones. "Today's devotional" has to change at the listener's
  midnight (and show from the church's publish hour), not at UTC midnight.
- The app must work offline for a week (`[HUMAN_GATE DV0]`, D4), so it needs future days.
- A day with nothing scheduled must still show something (thread decision, 2026-11-09).
- Devotionals are not gated content (like verses and announcements), so anonymous reads are fine.

## Decision

### 1. Dates are listener-local
`devotionals.date` is a `DATE`. The app computes its local date and calls
`GET /api/v1/devotionals/day/{YYYY-MM-DD}` or `GET /api/v1/devotionals/days?from=&count=1..8`.
The server accepts dates in `[utc_today − 1, utc_today + 8]`: every time zone's "today" plus the
7-day prefetch. Outside it: 422. The app shows a prefetched day only once its local date and the
church's `publish_hour` have arrived. Reading ahead through the API is possible and accepted.

### 2. Derived, not stored, publication
Live for D = `status = approved AND date = D`. "Scheduled" / "Published" / "Evergreen" are
labels computed at read time (`display_status`). No scheduler is involved.

### 3. Evergreen fallback
If no live dated devotional exists for D, the response is an approved evergreen row (date
`NULL`) chosen by `random.Random("devotional:" + D)` over the pool sorted by id — the same for
every listener on D. `source` says which (`"dated"` | `"evergreen"`); `date` is always D.
404 only when both are empty.

### 4. Response shape (`DevotionalPublic`)
`id, date, source, title, author{id,name}|null, still{breath_in,breath_out,seconds},
passage{ref,translation,text,verses[{number|null,text}]}, suggested_word|null,
reading{url,duration_s}|null, reading_fallback("text"|"tts"), tts{voice,rate}|null,
reflection_md, moment{sermon_id,title,cover_url,start_s,end_s}|null, pray{question,text},
carry_verse_ref, publish_hour`.

- `reading_fallback` is resolved server-side: the devotional's override (only while
  `church_settings.devotional_allow_override`) else the church setting. It is `"text"` whenever
  a reading exists. `tts` is present only when the fallback is `"tts"`.
- `moment` is omitted unless its sermon is itself publicly visible (published and past its
  `publish_at`). Tier gating stays with the existing stream endpoint.
- `reading.url` and `moment.cover_url` are signed, stable-window URLs (`stable_image_url`).
- Fields may be added; none removed or renamed without a new ADR.

### 5. Listener data stays on the device
Kept words, journal entries and "hold someone up" names are never sent to the API in v1
(`[HUMAN_GATE DV0]`, D2). No endpoint accepts them.

## Consequences

- The client owns "what is today" and the publish-hour gate; tests cover UTC−12 and UTC+14.
- Changing an approved devotional requires `reject` (back to editable) or `archive`, keeping the
  approval log honest.
- A future sync of journal data needs a new ADR (erasure, export, encryption at rest).
