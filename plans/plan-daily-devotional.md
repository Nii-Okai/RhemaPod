# Plan: Daily Rhema — daily devotional / quiet time

A daily devotional in the mobile app, written and scheduled in the admin portal. Each day is a
short guided quiet time in five movements: **Still → Hear → Ponder → Pray → Carry**. The listener
taps one word in the passage that speaks to them (their "rhema" for the day), which follows them
through the rest of the session and into a personal Word garden.

Design reference: the "Daily Rhema devotional" canvas (mobile screens 1–7, admin editor, Settings ›
Devotionals, calendar, bulk import), agreed in the project thread on 2026-11-09. Design decisions
made there are recorded in §Decisions already made and are binding unless changed at a gate.

Executors halt **only** at gates. A schema change, a new native dependency or a new public API
shape that isn't in this plan is a new gate: halt. Execution is logged in the append-only root
`status.md` with the prefix `DEVOTIONAL`, one `## DEVOTIONAL — <step> <date>` heading per step.

---

## Goal

A listener opens RhemaPod in the morning, sees today's devotional on Home, and goes through a
5–15 minute quiet time that works offline. Staff schedule devotionals as far ahead as they like
(single editor, calendar, or spreadsheet import), through the same review workflow as
announcements, and never leave listeners with an empty day.

## Definition of Done

- [ ] `devotionals` + `devotional_approval_log` tables and the new `church_settings` devotional
      columns exist via one Alembic migration that round-trips (`[HUMAN_GATE DV1]`).
- [ ] Public `GET /devotionals/day/{date}` and `GET /devotionals/days?from=&count=` return the
      devotional for a listener-local date, falling back to the evergreen pool, never an empty day
      while the pool has rows.
- [ ] Staff API: CRUD, submit/approve/reject/archive transitions, calendar range listing, reading
      audio upload, CSV import with a dry-run check step, settings read/write.
- [ ] Admin portal: Library › Devotionals (calendar week/month/quarter, gap alert, evergreen pool),
      editor with the five movements and live preview, bulk import wizard, Settings › Devotionals.
      Devotionals appear in the existing review queue.
- [ ] Mobile: Home card with week vine, the five-movement flow, tap-your-word, sermon moment,
      on-device journal, Carry card, Word garden, 7-day offline prefetch, text-to-speech fallback.
- [ ] Tests: backend (service + API + migration round-trip), admin portal (vitest), mobile (jest)
      all green; on-device checklist passes on iOS + Android (`[HUMAN_GATE DV4]`).
- [ ] ADR 0022 (devotional public contract + listener-local dates) Accepted (`[HUMAN_GATE DV2]`).

## Decisions already made (thread, 2026-11-09)

1. **Five movements**, in order: Still (breath + timer), Hear (passage + optional reading +
   tap-a-word), Ponder (reflection + optional sermon moment), Pray (question, journal, written
   prayer, optional "hold someone up"), Carry (word card, reminder, share). Every movement except
   Hear's passage is skippable.
2. **The word is the listener's.** Staff set an optional *suggested word*; it's the fallback when
   the listener doesn't tap one. Tapping another word moves the highlight; tapping the kept word
   again un-keeps it.
3. **Journal is optional** everywhere; an empty journal never blocks anything. No voice journal
   (mic button dropped).
4. **Pastor's reading is optional.** When it's missing, a church-wide setting chooses
   *Text only* or *Text-to-speech*; editors may override per devotional (setting-controlled). TTS
   is labelled "Read aloud", never with a pastor's name.
5. **Every day stands alone** — any passage, any translation; no assumption of a reading plan.
6. **Scheduling ahead:** dated devotionals, week/month/quarter/year views, gap alert when fewer
   than N (default 14) days ahead are ready, an **evergreen pool** that fills empty days, CSV bulk
   import with check step and clash handling (skip / replace draft / move to pool).
7. **No streak shaming:** missed days show as a bud on the vine, never a reset counter.

## Decisions at `[HUMAN_GATE DV0]` (bold = chosen)

`[HUMAN_GATE DV0]` passed 2026-11-09: Nii approved the plan with every recommendation below
(decision card in the project thread).

- **D1 Text-to-speech engine.** **On-device (`expo-speech`): free, works offline, voice depends on
  the phone.** Alternative: cloud TTS rendered once at publish time (consistent voice, per-character
  cost, a provider account and key).
- **D2 Where kept words + journal live.** **On the device only for v1** (private by construction,
  staff can never see it; lost on reinstall). Alternative: synced to the account (survives a new
  phone; needs a new table, encryption at rest, and inclusion in data export + deletion).
- **D3 Scripture text.** **Editor types the reference; the portal auto-fills KJV/WEB text from
  bible-api.com (as `seed_verses` already does) and the editor may edit it.** Other translations
  are pasted by hand (licensing is the church's responsibility).
- **D4 Prefetch vs. peeking.** **The app prefetches the next 7 days for offline use and only
  *shows* a day once it is that date locally.** A determined user could read ahead from the API;
  devotionals aren't secret, so this is accepted.
- **D5 Reminders + lock-screen widget.** **Deferred to Phase 4** (they need `expo-notifications`
  and a native widget extension — new native dependencies, new store builds).

---

## Data model (`[HUMAN_GATE DV1]` — schema)

`devotionals`
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| date | date, nullable, **unique where not null** | listener-local calendar date; null = evergreen |
| is_evergreen | bool, default false | CHECK: `is_evergreen = (date IS NULL)` |
| title | varchar(200) | |
| status | varchar(20) enum `devotional_status` (non-native) | draft / pending_review / approved / rejected / archived |
| author_speaker_id | uuid fk speakers, null, ON DELETE SET NULL | "Voice" in the editor |
| still_breath_in / still_breath_out | varchar(80), null | |
| still_seconds | smallint, null | null = church default |
| passage_ref | varchar(100) | e.g. `Psalm 46:1-3, 10` |
| passage_translation | varchar(20) | e.g. `kjv` |
| passage_text | text | verses separated by `\n`, each optionally prefixed `N ` |
| suggested_word | varchar(40), null | must occur in `passage_text` (case-insensitive) |
| reading_media_key | varchar(512), null | uploaded audio (R2), via the existing media ticket flow |
| reading_duration_s | int, null | |
| reading_fallback | varchar(10), null | null = church setting; `text` / `tts` override |
| reflection_md | text | limited markdown: paragraphs, *italic*, **bold**, `> pull quote` |
| moment_sermon_id | uuid fk sermons, null, ON DELETE SET NULL | |
| moment_start_s / moment_end_s | int, null | CHECK both-or-neither, end > start, ≤ 600 s span |
| pray_question | varchar(300) | |
| pray_text | text | |
| carry_verse_ref | varchar(100), null | null = `passage_ref` |
| created_by | uuid fk users RESTRICT | |
| created_at / updated_at | timestamptz | |

Indexes: `ix_devotionals_date_status (date, status)`, partial unique on `date`.

`devotional_approval_log` — same shape as `announcement_approval_log`.

`church_settings` new columns (all with server defaults so the singleton row stays valid):
`devotional_reading_fallback` (`text`|`tts`, default `text`), `devotional_allow_override`
(bool, true), `devotional_tts_voice` (varchar 60, null), `devotional_tts_rate_pct` (smallint 50–150, 90),
`devotional_publish_hour` (smallint 0–23, 5), `devotional_gap_alert_days` (smallint, 14),
`devotional_still_seconds` (smallint, 60), `devotional_default_translation` (varchar 20, `kjv`).

**Visibility rule:** a devotional is live for date D when `status = approved` and `date = D`.
"Scheduled" and "Published" are display labels derived from the date, not stored states (same
reasoning as `Announcement`: no worker has to be alive at 05:00).

**Evergreen pick:** when no live devotional exists for D, pick from approved evergreen rows by a
date-seeded shuffle (`random.Random(D.isoformat())`, same technique as `verse_service`), so
everyone gets the same one on the same day.

## Public API (`[HUMAN_GATE DV2]` — contract, ADR 0022)

- `GET /devotionals/day/{date}` → `DevotionalPublic` (+ `source: "dated" | "evergreen"`). 404 only
  when there's no dated row and the pool is empty. `date` must be within
  `[utc_today − 1, utc_today + 7]`, else 422 (covers every time zone + the prefetch window).
- `GET /devotionals/days?from={date}&count={1..7}` → list, same rules, one entry per date.
- `DevotionalPublic` carries: id, date, source, title, author (name, avatar), still {in, out,
  seconds}, passage {ref, translation, text, verses[]}, suggested_word, reading {url (signed,
  CDN), duration_s} | null, reading_fallback (`text`|`tts`, resolved), tts {voice, rate} | null,
  reflection_md, moment {sermon_id, title, cover_url, start_s, end_s} | null (only if the sermon
  is itself visible to the caller), pray {question, text}, carry_verse_ref, publish_hour.
- Anonymous callers allowed (devotional content, like verses/announcements).

## Staff API

Under `/devotionals/admin/*` and `/approvals/devotionals/*`, EditorPlus for writes of own drafts,
ManagerPlus for approve/reject/archive — mirroring announcements exactly:
list (`?from&to&status`), calendar summary (`?from&to` → per-day status), get, create, patch,
delete (draft/rejected only), submit, withdraw, approve, reject (note), archive; reading audio
`POST /{id}/reading-url` + `/reading/confirm`; `GET /devotionals/admin/passage?ref=&translation=`
(bible-api.com lookup, KJV/WEB only, cached); `POST /devotionals/admin/import?dry_run=true|false`
(CSV, max 400 rows, returns per-row `ready|warning|error` + clash list; commit honours
`as=draft|approved` (approved = ManagerPlus) and `on_clash=skip|replace_draft|to_pool`);
`GET/PATCH /admin/settings/devotionals` (version token, like church settings). Every write is
audit-logged (`audit_service`).

---

## Phases and steps

### Phase 0 — plan
- **DV0.1** This plan. `[HUMAN_GATE DV0]` — approve plan + answer D1–D5.

### Phase 1 — backend
- **B1** Models + migration + round-trip test. `[HUMAN_GATE DV1]` (schema).
- **B2** `devotional_service`: visibility, evergreen pick, transitions (reuse `approval.py` pattern),
  validation (suggested word in text, moment bounds, date uniqueness).
- **B3** Public router + schemas + ADR 0022. `[HUMAN_GATE DV2]` (contract).
- **B4** Staff router: CRUD, transitions, calendar, review queue inclusion.
- **B5** Reading audio upload (media ticket flow, audio content types only, ≤ 30 MB).
- **B6** Passage lookup (bible-api.com, KJV/WEB, 24 h Redis cache, timeout 4 s, staff only).
- **B7** CSV import (dry run + commit), template download.
- **B8** Devotional settings endpoints; `openapi.json` regenerated.

### Phase 2 — admin portal
- **A1** Nav item Library › Devotionals; API client + types from `openapi.json`.
- **A2** Calendar page: week/month/quarter/year, status colours, gap alert, evergreen pool panel.
- **A3** Editor: five movement sections, passage auto-fill, audio upload, sermon moment picker
  (search + in/out), live phone preview, submit/approve actions.
- **A4** Bulk import wizard (upload → check → schedule).
- **A5** Settings › Devotionals tab.
- **A6** Review queue shows devotionals alongside sermons/announcements.

### Phase 3 — mobile
- **M1** API hooks + query persistence; 7-day prefetch (D4).
- **M2** Home: Daily Rhema card + week vine; collapses to "Your word today" chip once done.
- **M3** Flow shell: full-screen stack, leaf progress, close/resume, Still screen.
- **M4** Hear: passage, tap-a-word, reading player (existing audio stack), TTS fallback (D1).
- **M5** Ponder: reflection renderer, sermon moment clip (existing player, start/end bounds).
- **M6** Pray: journal (on-device per D2), prayer, hold-someone-up; Carry card + share image.
- **M7** Word garden (Library or Me), month view, reopen past day.
- **M8** Light + dark theme pass, accessibility (Dynamic Type, screen reader order). On-device
  checklist. `[HUMAN_GATE DV4]`.

**Build notes (2026-11-10), where the build differs from the steps above:**
- Approvals happen on the devotional's own editor and on the "Waiting for review" panel in
  Library › Devotionals, not in the sermon review queue (that queue is sermon-only).
- Year view (A2) is not built. Quarter is the widest view.
- An approved devotional is read-only for everyone, managers included, until it is sent back
  with "Request changes" (ADR 0022 consequence, enforced on the server).
- M5: the sermon moment opens the existing player at `start_s` (new `startAt` param) and shows
  the end time. It does not stop playback at `end_s`.
- M6: Carry shares text through the system share sheet. A share image is deferred.
- M7: the word garden lives at `/devotional/garden`, reached from the Home card and from Carry.
  It shows each kept word with that day's verse and journal. Past days can't be reopened in
  full because the server window only covers yesterday onwards.
- D4: the week ahead is kept as text on the phone. The pastor's reading streams, so with no
  network the Hear step falls back to the text (or the phone's voice when the church chose TTS).

### Phase 4 — later (separate gates)
Midday reminder + morning notification (`expo-notifications`), lock-screen widget, church-wide
"words kept today" count, 7/21-day plans, evening Examen variant.

## Risks
- **Time zones:** dates are listener-local; server only bounds the window. Tests cover UTC−12 and
  UTC+14 edges.
- **bible-api.com availability:** lookup is a convenience; editors can always paste text.
- **Unique date + evergreen CHECK** must survive the import's `to_pool` path (date → null in the
  same transaction). Covered by B7 tests.
- **Sermon moment visibility:** a moment pointing at an unpublished or tier-locked sermon is
  omitted from the public payload rather than leaking it.
