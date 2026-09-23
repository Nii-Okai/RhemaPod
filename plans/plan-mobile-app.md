# Plan: RhemaPod Mobile Viewer App (React Native + Expo) — MVP

Design source of truth: `docs/design_mobile_app/mobile-design-spec.md` (ui-designer, build-ready) +
`docs/design_mobile_app/design-brief-extracted-text.txt`.
Backend source of truth: `app/api/*.py`, `app/services/*.py`, `app/models/models.py` — **read over
the design spec where the two disagree.** They disagree in several places; §A.9 is the register.

Predecessors whose decisions still hold and are not restated: `plans/plan.md` (auth hardening),
`plans/plan-admin-portal.md` §A (API client, data layer, testing bar), ADR 0002 (the mobile app and
the admin portal share one auth system — this is why §A.3 is a prerequisite rather than a nicety),
ADR 0008/0009 (publish/visibility semantics the app's catalog reads inherit).

Provenance: `skeptic` → `ui-designer` → `architect` → `skeptic` (2-round debate, protocol max) →
`architect` (revised delta) → Isaac's decisions. The decision table in §Locked is the settled output
of that chain. **Reopening any row there is a plan amendment, not an executor's call.**

Execution log: the append-only root `status.md`, never this file. Every work item below names the
entry it must append.

---

## Goal

Ship a single Expo codebase — iOS phone, Android phone (full Material 3 treatment), and tablet — that
a signed-in member uses to browse the church's published catalogue, watch or listen to a sermon with
resume, take timestamped notes while it plays, and download the audio to listen offline; on a media
pipeline (Cloudflare Stream) and an auth system (multi-session refresh tokens) that can survive more
than one device per person.

## Definition of Done

- [ ] A member installs an internal-distribution build on iOS **and** Android, signs in, and stays
      signed in across app kills and a locked device — **while their session on another device and
      their admin-portal session both stay alive** (§A.3, the thing that is broken today).
- [ ] Home renders hero + "Continue watching" + "Series" shelves from live API data; tapping through
      plays a Cloudflare Stream rendition on real hardware on both platforms, resumes from
      `position_seconds`, and writes progress back on pause/background/complete.
- [ ] A member takes, edits and deletes a timestamped note without playback stopping, and sees their
      notes for that sermon on return. Notes are visible to that user only — no staff read path.
- [ ] A member downloads a sermon's **audio** over Wi-Fi, sees real progress, sees an honest failure
      state with a working Retry, and plays it back with the device in airplane mode. The file at
      rest is encrypted with a per-install key in `expo-secure-store`.
- [ ] Every sermon the app can play has its **source master archived in S3 Glacier Deep Archive**,
      verified by reading back the storage class of a real object — not by trusting a lifecycle rule
      was configured.
- [ ] Tablet renders the rail nav + docked-player two-pane layout; iPad Split View at <768pt falls
      back to the phone layout (keyed off `useWindowDimensions`, not device model).
- [ ] Android renders the M3 chrome set (nav bar with pill indicator + always-visible labels,
      underlined drawer tabs, extended FAB) — not the iOS layout with different colours.
- [ ] `alembic upgrade head` → `downgrade` round-trips cleanly on every migration this plan lands.
- [ ] Backend: `uv run pytest -q --tb=short` green, no regression against the pre-plan baseline
      (540 passed / 1 skipped at commit `bc194bc`). Admin portal: `npm run verify` green.
- [ ] Mobile: typecheck + lint + unit/component tests green, and the device matrix in §F.2 exercised
      by hand with results written to `status.md`.
- [ ] `security-reviewer` has passed on: the multi-session auth rework, the Stream signed-token and
      audio-download endpoints, the rate-limiter re-key, and the at-rest download encryption. All
      four are mandatory, not discretionary.
- [ ] ADRs exist for: multi-session refresh tokens, the `get_stream` contract change + Stream
      adoption, the rate-limiter keying change, and `sermon_notes`. `openapi.json` regenerated and
      `admin_portal/lib/api/schema.d.ts` regenerated on every contract change.
- [ ] **No scope creep.** Nothing from §G ships.

---

## Locked — decided upstream, not relitigated here

| # | Decision | Resolution |
|---|---|---|
| L1 | Paid tier / IAP | **Cut indefinitely.** Free content only. No paywall screens, no membership/billing section, no `PAID` badge. |
| L2 | Anonymous browsing | **Cut.** Root route redirects unauthenticated users to sign-in. No content preview. |
| L3 | Platforms | iOS + Android + tablet **in parallel from day one**, one Expo codebase. Android M3 is a parallel treatment, not a later reskin. |
| L4 | Home / Player | Home = **1b Rails**. Player = **1d video + working drawer**, drawer reduced to Notes (Scripture/Transcript cut, L5). |
| L5 | Cut features | Transcripts, scripture cross-references, clip-share, a "Saved"/bookmarks tab, follow-a-series, push notifications, download storage-quota manager UI, paid-preview gates, membership/billing. |
| L6 | Offline downloads | **Audio-only in v1.** Deliberate partial override of the original "watch offline" ask: video would need a second rendition family and OS-level file protection weaker than what audio-only gets. Audio reuses the streaming rendition (30–60 MB/sermon) and gets real JS-level encryption. |
| L7 | Download encryption | Per-install random key in `expo-secure-store`, AES via a **JSI-backed native crypto module** (`react-native-quick-crypto` or equivalent). Pure-JS crypto is explicitly rejected — at 30–60 MB it is perceptibly slow and would force a "Preparing…" state that is otherwise avoidable. |
| L8 | Media pipeline | **Cloudflare Stream**, over self-hosted FFmpeg+arq and over MediaConvert+S3+CloudFront. **Condition, non-severable:** source masters archived to S3 Glacier Deep Archive in the same phase as ingest (§A.2, GATE M2). |
| L9 | No worker queue, no CloudFront | Stream ingest is async via its own API + a ready webhook. No signing keypair, no signed-cookie design. Stream issues signed playback tokens. |
| L10 | Quality cap | Delete `FREE_TIER_MAX_QUALITY` (`app/services/media_service.py:56`) — moot once Stream owns the rendition ladder. |
| L11 | Episode gaps | **Do not build the "episode 03 · 04 not yet published" disclosure.** Hide gaps; renumber on read. Showing them needs a backend disclosure surface the catalogue deliberately does not have. |
| L12 | Auth storage | Refresh token in `expo-secure-store` with `requireAuthentication` **OFF** (background downloads and refresh must work on a locked device). Access token in memory only. The portal's BFF/httpOnly-cookie pattern does not port. |
| L13 | Multi-session refresh | Hard prerequisite, independent of every other decision. Today's store is single-slot (§A.3). |
| L14 | Rate limiting | Re-key authenticated traffic on user id; keep per-IP for unauthenticated paths only (§A.4). |
| L15 | Navigation | Expo Router, **one identical route tree** across iOS/Android/tablet. Chrome differs, routes never fork. Breakpoint 768pt off `useWindowDimensions`. |
| L16 | Data layer | TanStack Query + its persistence layer over `expo-sqlite`/AsyncStorage. **Scrub position is not in TanStack Query** — local state, throttle-flushed to `POST /analytics/sermons/{id}/progress` every ~15–30 s and on pause/background/complete. |
| L17 | Build tooling | Expo **dev build** + EAS from day one. Expo Go cannot carry background audio, background downloads, or lock-screen controls. |
| L18 | F4 (unsigned CDN URL bypass) | **Already fixed** on `fix/cdn-unsigned-url-bypass` (commit `bc194bc`, in `security-reviewer`). No work item here. This plan assumes it is merged. |

### Resolved by the planner — overridable at GATE M1, then binding

The design spec's §5 lists ten genuinely-undecided items. Six of them block a screen and are resolved
here so `mobile-developer` never has to invent a product decision mid-build. If Isaac disagrees with
any of these, say so at GATE M1; after that they are contract.

| # | Spec §5 item | Resolution | Rationale |
|---|---|---|---|
| P1 | iOS "Saved" vs Android/tablet "Downloads" label | **"Downloads" on all three.** | Only one screen (1l) was ever designed for that destination. "Saved" advertises a bookmarks feature that L5 cuts. |
| P2 | No phone entry point to Announcements | **Home gets an announcements card/row; "Me" gets an Announcements row.** No 6th tab. | A 6th tab reopens the 1b tab-bar lock-in (L4). Two cheap entry points beat one IA change. |
| P3 | Tablet-only Series rail slot | **Stays tablet-only.** Phone reaches series via the Home "Series" shelf and Browse. | The tablet rail has room the phone tab bar does not. Not a gap. |
| P4 | Free sermon-detail composition | **`ui-designer` writes a composition addendum (W4.0) before Slice 1 builds it.** | The spec itself flags this as constructed from adjacent material, never drawn whole. It is a design decision, so it goes to the designer, not the implementer. |
| P5 | Home hero selection logic | **Newest published sermon = first item of `GET /sermons`.** No editorial pin, no backend change. | `content_service.list_published_sermons` already orders `published_at DESC NULLS LAST` (`app/services/content_service.py:306`). Free. |
| P6 | Avatar colour assignment | **Stable hash of the user/speaker id into `{status.slate, status.sage, #1F4276}`.** | The spec's own recommendation. Deterministic, no fourth meaning invented. |
| P7 | Decrypt-in-progress UI state | **Decided by measurement, not opinion** — W0.2 measures decrypt-to-first-audio on the oldest target device. Build the "Preparing…" state only if p95 > 400 ms. | This is the one §5 flag that is an engineering fact, so the spike answers it. |
| P8 | Notes / transcript / watch-history data | Notes: **built** (§A.5). Transcripts: **cut** (L5). Watch history: **existing** `GET /me/history`. **Profile's aggregate counts ("24", "96") are cut** — the Library section becomes two plain rows that navigate to the lists. | Counts would require paginating `/me/history` (a contract change) to be honest. Not worth a gate. |
| P9 | Downloads backend bookkeeping | **Purely client/device-local in v1.** No server-side download registry, no cross-device quota, no entitlement re-check per download beyond the endpoint's own authz. The "3.1 GB of 8 GB" summary reads device free space + the sum of local item sizes. | Everything is free (L1), so there is nothing to entitle against. A server registry with no consumer is an abstraction without a second use case. |
| P10 | Wheat-notice component | **Inline in the announcement card only.** Do not promote to a shared "notice" component. | One confirmed MVP use. |

---

# A. Architecture — what the executors need to know

## A.1 Where the app lives

New directory `mobile/` at the repo root, sibling to `admin_portal/`. Same monorepo, same
`status.md`, same `plans/`. It gets its own `package.json`, `tsconfig.json`, lint and test config, and
its own `.env.example` with placeholders only — **never** a committed `.env` (standing rule).

The app talks to the FastAPI backend **directly** over bearer tokens. There is no BFF. `admin_portal`
needs one because a browser cannot be trusted with a refresh token; a native app with Keychain/
Keystore can (L12).

## A.2 Media: Cloudflare Stream, and the S3 master that must not be skipped

**The ingest path deliberately does not change the admin portal's upload UI.** The editor still
presigned-PUTs the master straight to the S3 raw bucket (`POST /sermons/{id}/upload-url` →
`admin_portal/lib/upload/xhr-put.ts` → `POST /uploads/{job_id}/confirm`). What changes is what the
server does *after* confirm: instead of (notionally) transcoding, it hands Stream a short-lived
presigned URL to that raw object and lets Stream pull it ("upload via link"), then waits for the
ready webhook.

This is the design that makes L8's condition structurally hard to skip rather than a policy anyone has
to remember:

- **The S3 master is the input to Stream**, so it exists by construction. The Glacier lifecycle
  transition is then the only added step, and it operates on an object the pipeline already depends on.
- If someone later "optimises" by uploading direct-to-Stream from the browser, they delete the master
  and the archive at the same time — a visible, reviewable change, not a silent omission.

**W1.4 (Glacier) is inside the same phase and the same gate as W1.3 (ingest). It is not separately
gatable and not separately skippable.** Architect was explicit: the reversibility argument for
choosing a vendor over owned infrastructure to host a church's teaching archive collapses entirely if
this step slips to a follow-up ticket. Its verification is deliberately empirical — read back
`StorageClass` on a real object — because a configured lifecycle rule that never fires looks identical
to a working one until you need the tape.

**Do not set `CDN_BASE_URL`.** Cloudflare Stream is not the `cdn_base_url` seam. That setting has no
signing implementation behind it, `Settings.production_preflight` refuses to boot in production with
it set, and `app/scripts/preflight.py::_check_cdn` fails staging on it (commit `bc194bc`). Stream
playback URLs come from Stream's own signed-token API, through the media service, full stop.

**Completion handling, no queue (L9):** a webhook endpoint for the ready/error event plus a periodic
reconciliation sweep (`app/scripts/sweep_stream_jobs.py`) in the existing `app/scripts/` idiom
(`sweep_uploads.py` is the template). The sweep exists because a missed webhook must not leave a
sermon permanently unplayable, and it is the reason `upload_jobs` gains `attempts`/`started_at`/
`finished_at` — a sweep cannot make a safe retry decision without them.

**Blast radius on the admin portal (newly identified, previously unscoped):**
`admin_portal/components/review/sermon-player-dialog.tsx` plays the reviewer preview with a bare
`<video src={variant.url}>`. A bare `<video>` cannot play an HLS manifest outside Safari. So the
reviewer preview breaks the moment `get_stream` returns Stream URLs, and fixing it needs either
`hls.js` or Cloudflare's Stream player/embed — **a new frontend dependency, flagged under the standing
"don't add dependencies without flagging the tradeoff" rule** (W1.8). This is not optional cleanup:
without it, managers lose the ability to preview what they are approving.

## A.3 Auth: multi-session refresh tokens (the real blocker)

`app/core/token_store.py:47` keys the stored refresh jti as `refresh:{user_id}` — **one slot per
user, globally.** `store_refresh_jti` overwrites it on every login. Therefore: a second login on
*any* second device — a phone plus a tablet, a phone plus the admin portal (same auth system, ADR
0002) — silently evicts the first. The first device's next refresh presents a jti that no longer
matches, `rotate_refresh` (`app/services/auth_service.py:118-128`) treats it as theft, revokes, and
logs the user out. Both skeptic and architect flagged this as a phase-1 must-fix independent of every
other scope decision, and it is the reason this is not a "nice parallel track": **you cannot
meaningfully test the app on a second device until it is fixed.**

What the rework must deliver:

1. **Multi-session storage** — per-session keys (`refresh:{user_id}:{session_id}`) or a
   `user_sessions` table with device metadata. A table buys per-device names in a future "your
   devices" UI and survives a Redis flush; Redis-only keeps the existing failure posture simpler.
   `architect`'s call at W0.4 kickoff, recorded in `status.md` before code — not an executor's
   silent pick.
2. **Rotation grace window (~60 s)** — the previous jti stays acceptable briefly, so an app killed
   mid-refresh does not become an unrecoverable logout. Today there is no grace and the failure is
   terminal.
3. **Reuse of a pre-grace token ⇒ revoke the whole session family**, not just that session. This is
   what keeps the grace window from being a theft window.
4. **Global revoke stays global.** `reset_password` (`:170`), `change_password` (`:200`),
   `change_role` (`:360`) and `set_active` (`:423`, `:458`) must revoke **every** session for that
   user. Only `logout` (`:139`) becomes per-device. Getting this backwards is the exact silent failure
   skeptic flagged: revocation appears to work, and does not cover every device.
5. **Fail-closed posture preserved.** `token_store.py`'s module docstring is explicit and load-bearing:
   credential paths fail closed (503) on Redis loss, deliberately opposite to `rate_limit.py`. The
   multi-session rework must not quietly relax this into "allow if we can't check".
6. **Client-side single-flight refresh.** A cold Home screen fires several queries at once; concurrent
   401s must funnel into one refresh call. Without this, the rotation logic sees N-1 stale jtis and
   revokes the family — the client can manufacture the theft signal all by itself.

**`qa-strategist` designs the test matrix before implementation** (W0.3, per the debate's own
conclusion). This is an auth regression on a platform Isaac cannot hot-patch — App Store review
latency means a bad refresh path is a multi-day outage for every installed user.

## A.4 Rate limiting: re-key, restructure

`GlobalRateLimitMiddleware` (`app/core/middleware.py:121`, registered outermost at `main.py:78`) keys
on `global:{client_ip}` through a fixed-window INCR (`app/core/rate_limit.py`, fails open). That is
tuned for BFF traffic, where one portal session presents one server IP. Mobile inverts the
assumption twice over: carrier-grade NAT puts many users behind few addresses, and a congregation on
one church WiFi during a service is a realistic single-IP burst, not an edge case.

Direction: **per-user token bucket for authenticated requests, per-IP only for unauthenticated paths**
(register / login / forgot-password / reset-password). The implementation wrinkle is real and is why
this is a work item rather than a config tweak: the limiter is `BaseHTTPMiddleware` and runs *before*
auth resolves, so it has no user to key on. Two viable shapes — move the authenticated limit behind
auth resolution (a dependency, applied at the router level), or cheaply decode the bearer `sub` in the
middleware without a DB hit. `architect` picks at W2.1 kickoff and records why; the decode-in-middleware
option must not become a second, divergent token-validation path.

The fail-open posture stays fail-open (its rationale in `rate_limit.py`'s docstring still holds).

## A.5 Notes

New table, minimal, no relationships beyond the two foreign keys:

`sermon_notes(id, user_id → users.id, sermon_id → sermons.id, position_seconds, body, created_at, updated_at)`

Endpoints: `GET|POST /sermons/{id}/notes`, `PATCH|DELETE /notes/{id}`, `GET /me/notes`.

**Strictly user-owned.** No sharing, no staff visibility, no admin read path, no export. A note is a
person's own study; the review queue has no business reading it. Authorization is ownership-only —
not `require_role` — and `security-reviewer` checks specifically for a staff bypass, because every
other content read in this codebase has one by design and this one must not.

## A.6 Offline audio downloads

Flow: `GET /sermons/{id}/download/audio` returns a short-lived signed URL for the audio rendition
only → `expo-file-system` downloads to app-private storage → bytes encrypted with AES using a
per-install random key from `expo-secure-store` via the JSI crypto module (L7) → playback decrypts
on read.

Scope discipline: no video (L6), no server-side registry (P9), no quota manager UI (L5). The Downloads
screen must build the **failed state with a real reason and a working Retry** — the design spec is
explicit that this is the one screen where failure must never be hidden, and a half-downloaded
encrypted file is exactly the case a "we'll handle errors later" build gets wrong.

## A.7 Navigation and layout

One route tree (L15). Presentation forks three ways at the shell level only: iOS text-only tab bar,
Android M3 nav bar (icon + always-visible label, pill indicator), tablet rail + docked player. The
768pt breakpoint reads `useWindowDimensions`, **never** device model — this is deliberate so iPad
Split View at a narrow width correctly renders the phone layout instead of a cramped two-pane.

## A.8 Data layer

TanStack Query with persistence over `expo-sqlite` for offline catalogue browsing (L16). The typed API
client is generated from `openapi.json`, the same source the portal's `schema.d.ts` uses — so a
contract change that breaks the app breaks typecheck rather than production.

Player position is explicitly **outside** Query (L16): local state, throttle-flushed to
`POST /analytics/sermons/{id}/progress` every 15–30 s and on pause/background/complete. Writing every
tick would hammer both the API and the new per-user rate limiter — the app would rate-limit itself.

## A.9 Where the design spec and the backend disagree

| Spec says | Backend says | Winner |
|---|---|---|
| Player drawer has Scripture + Transcript tabs | No transcript or cross-reference data exists anywhere | Backend. Cut (L5). |
| Series list shows "episode 03 · 04 not yet published" | `Sermon.episode_number` gaps are legal and carry no published/unpublished disclosure | Backend. Renumber on read (L11). |
| Profile shows "Notes & highlights: 24 · Watch history: 96" | No counts endpoint; `/me/history` is an unpaginated list | Backend. Counts cut (P8). |
| "highlights" alongside notes | No highlight model, no UI behind the word anywhere in the source | Backend. The feature is "Notes". |
| Paid-gate screens, PAID badge, membership block | Real in the backend, but cut by product (L1) | Product. Cut. |

---

# B. Gate register

Eleven gates. **Never cross one without explicit approval from Isaac in chat.** Where two are marked
batchable, they may be reviewed in one sitting — that is the intended way to keep gate latency from
becoming the dominant cost.

| Gate | Category | What it guards | Blocks |
|---|---|---|---|
| **M1** | scope | This plan, including the P1–P10 planner resolutions and the §E cost disclosure | All execution |
| **M2** | cost · external contract · **Isaac-only** | Cloudflare account + Stream enabled + scoped API token; S3 Glacier Deep Archive bucket/lifecycle; one test master uploaded. **The Glacier item is not severable from the Stream item** (L8, §A.2) | W0.2, all of Phase 1 |
| **M3** | irreversible commitment | The W0.2 hardware spike verdict. A fail invalidates the player, downloads, and the `get_stream` contract change | Phase 1 merge, Phase 4 Slices 2 and 5 |
| **M4** | auth (+ schema if `user_sessions` lands) | The multi-session refresh rework, after `security-reviewer` and `reviewer-gilfoyle` | Merge to `main`; any second-device testing |
| **M5** | schema · public API | `stream_uid` + `upload_jobs` bookkeeping migration **and** the `get_stream` response contract change + audio-download endpoint + `FREE_TIER_MAX_QUALITY` deletion. Enumerated as two categories in one gate because they land together; approving it approves both, and neither is crossed implicitly | Phase 1 merge |
| **M6** | auth · abuse posture | Rate-limiter re-keying and middleware restructure | Merge to `main` |
| **M7** | schema · public API | `sermon_notes` table + endpoints | Merge to `main`. Batchable with M6 |
| **M8** | judgment checkpoint | App foundation on real hardware: sign-in, token refresh across app-kill, shell + tablet breakpoint, offline catalogue read | Phase 4 (all screen slices) |
| **M9** | new dependency · secrets-at-rest | `react-native-quick-crypto` (or equivalent JSI module) adoption + the per-install key design, after `security-reviewer` | Slice 5 merge |
| **M10** | cost · external commitment · **Isaac-only** | EAS Production, Apple Developer Program, Google Play Console provisioning + credential custody (§E) | Phase 5 distribution builds |
| **M11** | irreversible | Release readiness and first store submission — public artifact, multi-day review latency, no hot-patch | Any submission |

---

# C. Phase 0 — Prerequisites (three parallel tracks)

Nothing here builds a screen. Everything here removes a reason a screen would have to be rebuilt.
**Track A, Track B and Track C have no dependency on each other** and are the plan's genuine
parallelism.

### W0.1 — Provision the media and archive accounts · **[HUMAN_GATE M2]**
- **Owner:** **Isaac, personally.** Not an agent.
- **What:** Create the Cloudflare account, enable Stream, mint an API token scoped to Stream only.
  Create/confirm the S3 raw bucket's Glacier Deep Archive lifecycle transition. Upload one real
  sermon master as the spike's test asset. Have an Android device and an iOS device available (a free
  Apple ID suffices for a 7-day development profile at this stage — the paid programme is M10).
- **Files / scope:** no repo changes except placeholder keys appended to `.env.example`
  (`CF_ACCOUNT_ID`, `CF_STREAM_API_TOKEN`, `CF_STREAM_SIGNING_KEY_ID`, `S3_ARCHIVE_*`) — **placeholders
  only, never real values.**
- **Why Isaac:** same reason `DEPLOYMENT.md:179` says "Isaac does this step himself" for Resend domain
  verification — account creation, billing and credential custody are not things this codebase or its
  agents can do on his behalf.
- **Verification:** `curl` the Stream API with the token and get a 200; the test master's S3 object
  exists; the lifecycle rule is visible in the bucket config.
- **Status update:** `[MOBILE — W0.1 accounts] <agent: isaac>`

### W0.2 — The hardware spike (1 day, blocking) · **[HUMAN_GATE M3]** after
- **Owner:** `mobile-developer`
- **What:** A throwaway Expo dev build, run on **real** iOS and Android hardware, that proves four
  things and measures a fifth:
  1. `expo-video` plays a Cloudflare Stream **signed-token HLS** URL — play, seek, and background
     audio continuing with the screen locked.
  2. The audio-download endpoint's shape yields a file `expo-file-system` can actually fetch to
     completion (backgrounded, and resumed after a network drop).
  3. The JSI crypto module encrypts and decrypts a 60 MB file on device.
  4. Lock-screen / notification transport controls appear and work.
  5. **Measures** decrypt-to-first-audio latency on the oldest target device — this is the datum that
     resolves P7, and the only honest way to decide whether a "Preparing…" state is needed.
- **Files / scope:** `mobile/spike/` or a throwaway project outside the repo. **No production code.
  Nothing from this spike is merged.**
- **Verification:** written evidence appended to `status.md` — device models, OS versions, per-item
  pass/fail, the measured latency number, and screenshots or a screen recording for item 1. A verbal
  "it worked" is not verification.
- **Honest framing:** architect judges this lower-risk than the CloudFront/AVPlayer-cookie spike it
  replaces — **and was explicit that the judgment itself is what the spike exists to test.** Treat a
  fail as a genuine possibility, not a formality. If item 1 fails, stop and re-open the media decision
  at M3 before anything in Phase 1 merges.
- **Status update:** `[MOBILE — W0.2 Stream/expo-video spike] <agent: mobile-developer>`

### W0.3 — Test matrix for the multi-session auth rework
- **Owner:** `qa-strategist`
- **What:** Design the test matrix **before** implementation, per §A.3. Must cover at minimum: two
  devices + the portal concurrently; refresh under the grace window; refresh with a pre-grace token
  (expect family revoke); concurrent refresh from one client (single-flight); per-device logout leaving
  siblings alive; `reset_password` / `change_password` / `change_role` / `set_active` each killing
  **all** sessions; Redis-unavailable fail-closed behaviour on each path. Name the layer for each
  (unit / endpoint via `httpx.AsyncClient` + `ASGITransport` / Testcontainers Postgres + real Redis)
  and say plainly which cases the harness cannot reach.
- **Files / scope:** output to `status.md` only — no test code yet.
- **Verification:** every numbered failure mode in §A.3 maps to at least one named case, and the
  global-vs-per-device revocation split has explicit coverage in both directions.
- **Status update:** `[MOBILE — W0.3 auth test matrix] <agent: qa-strategist>`

### W0.4 — Implement multi-session refresh tokens
- **Owner:** `senior-dev-backend` (storage-shape decision recorded by `architect` at kickoff, §A.3 #1)
- **What:** Everything in §A.3 items 1–5. If `user_sessions` lands, one additive Alembic migration,
  reviewable, with a clean `downgrade`.
- **Files / scope:** `app/core/token_store.py`, `app/services/auth_service.py` (the seven call sites
  enumerated in §A.3), `app/api/auth.py`, `alembic/versions/` (conditional), `app/models/models.py`
  (conditional), `tests/test_auth*.py` + a new `tests/test_multi_session.py`.
- **Verification:** W0.3's matrix implemented and green; `uv run pytest -q --tb=short` shows no
  regression against 540/1; a manual two-client check (curl + the running portal) proving the portal
  session survives a mobile login.
- **Status update:** `[MOBILE — W0.4 multi-session refresh] <agent: senior-dev-backend>`

### W0.5 — Review the auth rework · **[HUMAN_GATE M4]** after
- **Owner:** `security-reviewer`, then `reviewer-gilfoyle`
- **What:** `security-reviewer` — grace window as a theft window, family-revoke correctness, the
  global-vs-per-device split at every call site, fail-closed preservation, session-id unguessability.
  `reviewer-gilfoyle` — correctness and whether the tests test the behaviour they are named after.
- **Verification:** both verdicts in `status.md`. Any Block finding returns to W0.4; M4 is not
  approached with open Blocks.
- **Status update:** `[MOBILE — W0.5 auth review] <agent: security-reviewer>` / `<agent: reviewer-gilfoyle>`

### W0.6 — Scaffold the Expo app (Track C, starts at M1)
- **Owner:** `noob-dev`
- **What:** `mobile/` — Expo + TypeScript + Expo Router, dev-build config, the empty route tree
  matching §A.7, lint/typecheck/test harness, `.env.example` with placeholders. **No screens, no
  theme values, no API calls.** Mechanical scaffolding only.
- **Files / scope:** `mobile/**` (new), root `.gitignore` (mobile artefacts).
- **Verification:** `npm run typecheck` and `npm run lint` clean from `mobile/`; the dev build boots
  to a blank routed screen on a simulator.
- **Status update:** `[MOBILE — W0.6 scaffold] <agent: noob-dev>`

---

# D. Phase 1 — Media pipeline (backend + one portal fix)

Starts after **M2**; must not merge before **M3**, **M5**.

### W1.1 — Migration: `stream_uid` + upload bookkeeping
- **Owner:** `senior-dev-backend`
- **What:** Additive Alembic migration — `stream_uid` (nullable) on `Sermon` or `MediaRef` (architect
  picks and records which; `MediaRef` is the better fit if audio and video become separate Stream
  entries), plus `attempts`, `started_at`, `finished_at` on `upload_jobs` (§A.2 explains why the sweep
  needs them). Nothing destructive, nothing dropped.
- **Files / scope:** `alembic/versions/`, `app/models/models.py` (`:158` Sermon / `:239` MediaRef /
  `:320` UploadJob).
- **Verification:** `alembic upgrade head` then `downgrade` round-trips on a real Postgres; existing
  suite green.
- **Status update:** `[MOBILE — W1.1 stream migration] <agent: senior-dev-backend>`

### W1.2 — Stream provider seam
- **Owner:** `senior-dev-backend`
- **What:** A `app/core/stream.py` seam in the established idiom of `storage.py` / `payments.py` /
  `email.py`: an interface, a real Cloudflare implementation, a **local stub** for dev and test, and a
  `_check_stream()` added to `app/scripts/preflight.py`'s check list plus a
  `Settings.production_preflight` refusal to boot on the stub.
- **Files / scope:** `app/core/stream.py` (new), `app/core/config.py`, `app/scripts/preflight.py`,
  `tests/test_preflight_stream.py` (new).
- **Verification:** unit tests on the seam; preflight fails on stub-in-production and passes when
  configured; the whole suite still runs with zero Cloudflare credentials present.
- **Status update:** `[MOBILE — W1.2 stream seam] <agent: senior-dev-backend>`

### W1.3 — Ingest: hand Stream the master, handle completion
- **Owner:** `senior-dev-backend`
- **What:** On `POST /uploads/{job_id}/confirm`, presign the raw object and start a Stream
  copy-from-URL; persist the returned uid; add a **webhook endpoint** for ready/error (signature
  verified, idempotent — `ProcessedWebhook` is the existing precedent for replay safety); add
  `app/scripts/sweep_stream_jobs.py` reconciling jobs whose webhook never arrived, in the
  `sweep_uploads.py` idiom.
- **Files / scope:** `app/services/media_service.py`, `app/api/media.py`, `app/api/` (webhook route),
  `app/scripts/sweep_stream_jobs.py` (new), `tests/test_stream_ingest.py` (new).
- **Verification:** endpoint tests against the stub covering ready, error, duplicate webhook delivery,
  and missed-webhook-then-sweep; **one real end-to-end ingest of the W0.1 test master against live
  Cloudflare**, evidenced in `status.md`.
- **Status update:** `[MOBILE — W1.3 stream ingest] <agent: senior-dev-backend>`

### W1.4 — Archive source masters to Glacier Deep Archive — **not skippable**
- **Owner:** `senior-dev-backend`
- **What:** The raw master's transition to Deep Archive, asserted by the code path rather than assumed
  from bucket config: the ingest path records the archive intent, and a check (script or preflight
  item) verifies objects are landing in the expected storage class. Document the restore path —
  Deep Archive restores take hours and that must be written down *before* someone needs it at 2 a.m.
- **Files / scope:** `app/core/storage.py`, `app/scripts/` (archive verification), `DEPLOYMENT.md`
  (restore procedure), `tests/`.
- **Verification:** `head_object` on the W0.1 test master reports a Deep Archive storage class (after
  the transition window) — **read back from the real object, not inferred from the lifecycle rule.**
  The restore procedure in `DEPLOYMENT.md` names the actual command and the actual expected latency.
- **Contract note:** this item shares W1.3's gate (M5) by design and has no gate of its own. An
  executor may not defer it, and the Conductor may not approve deferring it — per L8 it is the
  condition on which the vendor choice rests. If it cannot be done, that is an amendment and a
  re-opening of the media decision, not a slip.
- **Status update:** `[MOBILE — W1.4 glacier archive] <agent: senior-dev-backend>`

### W1.5 — `get_stream` returns Stream signed URLs · part of **[HUMAN_GATE M5]**
- **Owner:** `senior-dev-backend`
- **What:** `get_stream` (`app/services/media_service.py:484`) returns Stream signed-token playback
  URLs instead of presigned S3 URLs. **Delete `FREE_TIER_MAX_QUALITY` (`:56`) and the rendition filter
  at `:539`** (L10). Keep every authorization behaviour that is already there and correct: 404 for
  not-yet-visible content, the editor-own-draft ownership test, the 409 when no media exists. The
  `StreamResponse`/`StreamVariant` shape (`app/models/content_schemas.py:440-449`) changes only in
  what `url` points at and what `expires_in` means — keep the shape if at all possible, because
  `admin_portal/lib/api/schema.d.ts` and the app both read it.
- **Files / scope:** `app/services/media_service.py`, `app/models/content_schemas.py`,
  `app/api/media.py:151`, `tests/test_media.py`, `openapi.json`, `admin_portal/lib/api/schema.d.ts`.
- **Verification:** `tests/test_media.py` updated and green including the paid-tier and
  visibility-authz cases that must survive the quality-cap deletion; `openapi.json` regenerated via
  `uv run python -m app.scripts.dump_openapi`; portal `schema.d.ts` regenerated; a real signed URL
  plays in a browser (Safari) and on device.
- **Status update:** `[MOBILE — W1.5 get_stream contract] <agent: senior-dev-backend>`

### W1.6 — Audio-download endpoint · part of **[HUMAN_GATE M5]**
- **Owner:** `senior-dev-backend`
- **What:** `GET /sermons/{id}/download/audio` → short-lived signed URL for the **audio rendition
  only**. Same authz as `get_stream`. No video path, ever (L6). No server-side download registry (P9).
- **Files / scope:** `app/api/media.py`, `app/services/media_service.py`,
  `app/models/content_schemas.py`, `tests/test_media.py`, `openapi.json`.
- **Verification:** endpoint tests for authz parity with `get_stream`, for "no audio rendition" → 409,
  and for URL expiry; the returned URL actually fetched to completion by `curl` and (per W0.2) by
  `expo-file-system`.
- **Status update:** `[MOBILE — W1.6 audio download endpoint] <agent: senior-dev-backend>`

### W1.7 — ADR for the media decision
- **Owner:** `scribe`
- **What:** `docs/adr/0010-cloudflare-stream-media-pipeline.md` — the choice and the two rejected
  alternatives, the Glacier condition **and why it is a condition**, the contract change, the deleted
  quality cap, and the no-CDN_BASE_URL rule with its reason.
- **Verification:** the ADR states what changed in the public API precisely enough that a future
  reader can date the break without reading the diff.
- **Status update:** `[MOBILE — W1.7 ADR 0010] <agent: scribe>`

### W1.8 — Fix the admin portal's reviewer preview (HLS) — new dependency
- **Owner:** `senior-dev-frontend`
- **What:** `sermon-player-dialog.tsx`'s bare `<video src>` cannot play HLS outside Safari (§A.2).
  Adopt `hls.js` or Cloudflare's Stream embed and wire it through `use-sermon-stream.ts`.
- **Files / scope:** `admin_portal/components/review/sermon-player-dialog.tsx`,
  `admin_portal/lib/query/hooks/use-sermon-stream.ts`, `admin_portal/package.json`,
  `admin_portal/tests/review/*`.
- **Dependency flag:** state the tradeoff to Isaac in the status entry — bundle size, who maintains it,
  and what breaks if it is dropped later. Do not add it silently.
- **Verification:** `npm run verify` green; a manager plays a real Stream-backed sermon in the review
  dialog in Chrome **and** Safari.
- **Status update:** `[MOBILE — W1.8 portal HLS preview] <agent: senior-dev-frontend>`

### W1.9 — Backfill the existing catalogue into Stream
- **Owner:** `senior-dev-backend`
- **What:** A one-shot `app/scripts/backfill_stream.py` that ingests already-published sermons' masters
  into Stream and archives them per W1.4. **Without this the app has nothing to play**, which is why
  it is a work item and not an afterthought.
- **Files / scope:** `app/scripts/backfill_stream.py` (new), `tests/`.
- **Verification:** idempotent (re-running skips already-ingested sermons); dry-run mode; run against
  the dev stack and report counts — ingested / skipped / failed, with the failures named.
- **Status update:** `[MOBILE — W1.9 stream backfill] <agent: senior-dev-backend>`

### W1.10 — Review Phase 1
- **Owner:** `security-reviewer`, then `reviewer-gilfoyle`, then `qa-strategist`
- **What:** `security-reviewer` — signed-token TTL and scope, webhook signature verification and
  replay, download-endpoint authz, whether deleting the quality cap opened anything, credential
  handling for the Stream token. `reviewer-gilfoyle` — the usual. `qa-strategist` — coverage
  assessment of the ingest/webhook/sweep paths.
- **Verification:** three verdicts in `status.md`; no open Blocks at M5.
- **Status update:** `[MOBILE — W1.10 phase 1 review] <agent: …>`

---

# E. Phase 2 — Remaining backend surfaces

Independent of Phase 1 — **may run concurrently with it.** Gated at M6 and M7 (batchable).

### W2.1 — Re-key the rate limiter · **[HUMAN_GATE M6]**
- **Owner:** `senior-dev-backend` (approach recorded by `architect` at kickoff, §A.4)
- **What:** Per-user token bucket for authenticated requests; per-IP retained for register / login /
  forgot-password / reset-password. Restructure the middleware per §A.4. Fail-open posture preserved.
- **Files / scope:** `app/core/middleware.py:121`, `app/core/rate_limit.py`, `app/core/config.py`,
  `main.py:78`, `app/core/dependencies.py` (if the dependency shape is chosen),
  `tests/test_rate_limit*.py`.
- **Verification:** tests proving (a) two authenticated users behind one IP do not consume each
  other's budget, (b) unauthenticated login attempts are still IP-limited, (c) Redis down ⇒ allowed,
  (d) an unauthenticated request cannot claim another user's bucket by forging a `sub`. Real Redis for
  (a)–(c).
- **Status update:** `[MOBILE — W2.1 rate limiter re-key] <agent: senior-dev-backend>`

### W2.2 — `sermon_notes` · **[HUMAN_GATE M7]**
- **Owner:** `senior-dev-backend`
- **What:** §A.5 — the table (one additive migration), the five endpoints, ownership-only authz, a
  `notes_service` raising typed `ContentError`s mapped at the router boundary per house style.
- **Files / scope:** `alembic/versions/`, `app/models/models.py`, `app/models/content_schemas.py`,
  `app/services/notes_service.py` (new), `app/api/notes.py` (new), `main.py` (router),
  `tests/test_notes.py` (new), `openapi.json`.
- **Verification:** endpoint tests proving a user cannot read, patch or delete another user's note
  (404, not 403 — do not confirm existence), that **staff have no bypass**, that a note on an invisible
  sermon 404s, and that `position_seconds` is validated. Migration round-trips.
- **Status update:** `[MOBILE — W2.2 sermon_notes] <agent: senior-dev-backend>`

### W2.3 — Hide episode gaps (renumber on read)
- **Owner:** `senior-dev-backend`
- **What:** Per L11, the series episode reads present contiguous display numbers over whatever
  `episode_number` values exist. Display-layer only — **do not rewrite `episode_number` in the
  database**, which is editor-owned data and where the admin portal's episode-order feature lives.
- **Files / scope:** `app/services/content_service.py`, `app/api/series.py:185`,
  `app/models/content_schemas.py`, `tests/`.
- **Verification:** a series with episodes 1, 2, 5 reads as 01, 02, 03 on the public endpoint while
  the admin endpoint and the DB still show 1, 2, 5.
- **Status update:** `[MOBILE — W2.3 episode renumber] <agent: senior-dev-backend>`

### W2.4 — ADRs for Phase 2
- **Owner:** `scribe`
- **What:** `docs/adr/0011-multi-session-refresh-tokens.md` (from W0.4 — written here because the
  design is only final after M4), `docs/adr/0012-rate-limit-keying.md`,
  `docs/adr/0013-sermon-notes.md`.
- **Verification:** each names the decision, the alternatives, and the consequence a future reader
  will trip over. No "leveraging" prose.
- **Status update:** `[MOBILE — W2.4 ADRs 0011-0013] <agent: scribe>`

### W2.5 — Review Phase 2
- **Owner:** `security-reviewer` (mandatory on W2.1 and W2.2), then `reviewer-gilfoyle`
- **Verification:** verdicts in `status.md`; no open Blocks at M6/M7.
- **Status update:** `[MOBILE — W2.5 phase 2 review] <agent: …>`

---

# F. Phase 3 — App foundation

Starts once **W0.6** exists and **M4** is crossed (M4, not M3 — see §H.2 for why the auth fix, not the
spike, is what gates on-device sign-in). Ends at **M8**.

### W3.1 — Theme, tokens, primitives
- **Owner:** `mobile-developer`
- **What:** Design tokens from spec §1 — the surface ramp, the three text levels, the four gold shades
  kept distinct, the status pairs, the rationalized spacing (`4·8·12·16·20·24`) and radius
  (`6·9·12·16·pill`) scales. Three font families with their **strict** roles (Newsreader display,
  Figtree UI, IBM Plex Mono for numeric/temporal only). Shared primitives from spec §4. Sizes map to
  scalable font units so OS text-size settings are respected (spec §6).
- **Files / scope:** `mobile/theme/**`, `mobile/components/**`.
- **Verification:** a tokens/primitives gallery route renders every primitive in both platform chromes;
  a test asserts no raw hex outside the token file; text scales with an OS-level larger-text setting.
- **Status update:** `[MOBILE — W3.1 theme + primitives] <agent: mobile-developer>`

### W3.2 — Auth on device
- **Owner:** `mobile-developer`
- **What:** Refresh token in `expo-secure-store` (`requireAuthentication` **off**, L12), access token in
  memory, **single-flight refresh** (§A.3 #6 — the client-side half of the auth fix, and the part that
  can manufacture a false theft signal if it is got wrong), root-route redirect for unauthenticated
  users (L2), and the sign-in / register / forgot-password screens (spec 1m minus anonymous browsing),
  reusing the portal's auth-error copy where it applies.
- **Files / scope:** `mobile/app/(auth)/**`, `mobile/lib/auth/**`, `mobile/lib/api/**`.
- **Verification:** tests proving N concurrent 401s produce exactly **one** refresh call; on-device
  proof that sign-in survives app kill and a locked device; proof that a second device login leaves the
  first device and the portal session alive (the thing W0.4 fixed — verify it end to end here, not
  just in the backend suite).
- **Status update:** `[MOBILE — W3.2 device auth] <agent: mobile-developer>`

### W3.3 — Data layer
- **Owner:** `mobile-developer`
- **What:** TanStack Query + persistence over `expo-sqlite` (L16); typed client generated from
  `openapi.json`; query-key conventions; error and retry policy that plays nicely with the new
  per-user rate limiter (no retry storms).
- **Files / scope:** `mobile/lib/query/**`, `mobile/lib/api/**`.
- **Verification:** a cached catalogue list renders with the network disabled; typecheck fails if the
  generated schema drifts from `openapi.json`.
- **Status update:** `[MOBILE — W3.3 data layer] <agent: mobile-developer>`

### W3.4 — Navigation shell, three chromes
- **Owner:** `mobile-developer`
- **What:** One route tree (L15, §A.7). iOS text-only 5-tab bar (Home · Browse · Search · **Downloads**
  · Me — P1). Android M3 nav bar. Tablet rail (Home · Series · Browse · Search · Downloads ·
  Announcements + avatar row, membership label dropped). 768pt breakpoint off `useWindowDimensions`.
- **Files / scope:** `mobile/app/**`, `mobile/components/navigation/**`.
- **Verification:** the same route renders all three chromes; resizing an iPad into narrow Split View
  falls back to the phone layout live; no route path differs by platform (assert it in a test).
- **Status update:** `[MOBILE — W3.4 nav shell] <agent: mobile-developer>`

### W3.5 — Review the foundation · **[HUMAN_GATE M8]** after
- **Owner:** `reviewer-gilfoyle`, then `qa-strategist`
- **What:** gilfoyle on the auth client and single-flight refresh specifically. `qa-strategist` sets the
  mobile testing bar for Phase 4 — what gets component tests, what only a device can prove, and the
  §F.2 device matrix.
- **Device matrix (F.2), to be fixed here and used for every later slice:** oldest supported iPhone
  and iOS version, a current iPhone, one low-end Android and one current Android, one iPad in full
  screen and in Split View. Named models recorded in `status.md` so "tested on device" means something.
- **Verification:** both verdicts in `status.md`; M8 walkthrough performed on at least one iOS and one
  Android device.
- **Status update:** `[MOBILE — W3.5 foundation review] <agent: …>`

---

# G. Phase 4 — Screens, in independently shippable slices

After **M8**. Each slice is self-contained: build → `reviewer-gilfoyle` → merge. A slice that turns
out to need something the backend does not have **halts and returns to the Conductor** — it does not
invent a backend or a product decision (§H.4).

### W4.0 — Free sermon-detail composition addendum (P4)
- **Owner:** `ui-designer`
- **What:** Compose the free-variant sermon detail screen as an addendum to the spec — it was never
  drawn whole and is a design decision, not an implementation one. Then say how the Android M3 chrome
  swap applies to it (spec §5 item 4's second-order unknown).
- **Files / scope:** `docs/design_mobile_app/mobile-design-spec.md` (append a §8 addendum).
- **Verification:** the addendum shows composition and states for loading, error, and no-media; it
  invents no data the API does not return.
- **Status update:** `[MOBILE — W4.0 free detail composition] <agent: ui-designer>`

### W4.1 — Slice 1: Home + sermon detail
- **Owner:** `mobile-developer`
- **Reads:** `GET /sermons`, `GET /sermons/{id}`, `GET /me/continue-watching`, `GET /series`.
- **What:** Hero (P5: first item of `GET /sermons`), "Continue watching" shelf (omit when empty — the
  spec shows no empty-state card), "Series" shelf, the announcements entry point (P2), skeleton loading,
  and the W4.0 detail screen. Android M3 chrome in the same slice, not after (L3).
- **Verification:** component tests over fixtures for populated / empty / loading / error; both chromes
  on device; no raw hex outside the token file.
- **Status update:** `[MOBILE — W4.1 slice 1 home+detail] <agent: mobile-developer>`

### W4.2 — Slice 2: Player + Notes drawer + progress *(depends on M3, M5, M7)*
- **Owner:** `mobile-developer`
- **What:** `expo-video` on a Stream signed URL, transport controls, speed, sleep timer, background
  audio, lock-screen controls, buffering state (spec flags it as required and absent from the source),
  the Notes drawer (iOS segmented control / Android underlined tabs + extended FAB) with a real
  empty state, and progress flush per L16 (every 15–30 s + pause/background/complete; resume from
  `position_seconds`).
- **Verification:** device matrix played end to end including background audio with the screen locked;
  a test proving progress writes are throttled, not per-tick; notes CRUD against the real API; token
  expiry mid-playback handled (refresh and continue, not a hard stop).
- **Status update:** `[MOBILE — W4.2 slice 2 player+notes] <agent: mobile-developer>`

### W4.3 — Slice 3: Browse + Search
- **Owner:** `mobile-developer`
- **Reads:** `GET /categories`, `GET /speakers`, `GET /search`, `GET /search/suggest`.
- **What:** Flat category list with counts; speaker list with the avatar chip (P6) and the source's
  verbatim "No bio yet" fallback; search with live suggestions and grouped results; empty-query and
  no-results states matching the portal's existing copy convention. Android adds the M3 top search bar
  as drawn.
- **Verification:** component tests for each state; debounce on `/search/suggest` proven by test (an
  undebounced suggest box against a per-user rate limiter self-throttles).
- **Status update:** `[MOBILE — W4.3 slice 3 browse+search] <agent: mobile-developer>`

### W4.4 — Slice 4: Series + Announcements *(depends on W2.3)*
- **Owner:** `mobile-developer`
- **Reads:** `GET /series/{id}`, `GET /series/{id}/episodes`, `GET /announcements`.
- **What:** Series art, synopsis, episode list with renumbered mono numbers (L11 — **no gap rows**) and
  per-episode status ("watched" / "17:04 left" / "new"); announcements pinned-first with the inline
  wheat notice (P10), image, body, date range including the ongoing "→ —" case, and an empty state.
- **Verification:** a series with DB gaps renders contiguously; announcements render pinned-first with
  no client-side date filtering (the server already windows them).
- **Status update:** `[MOBILE — W4.4 slice 4 series+announcements] <agent: mobile-developer>`

### W4.5 — Slice 5: Offline audio downloads · **[HUMAN_GATE M9]** *(depends on M3, W1.6)*
- **Owner:** `mobile-developer`, with `security-reviewer` before merge
- **What:** §A.6 end to end — queue, background download, Wi-Fi-only toggle, at-rest encryption with
  the per-install SecureStore key, offline playback, delete, and the **failed state with a real reason
  and a working Retry**. The "Preparing…" state only if W0.2's measurement demanded it (P7).
- **Dependency flag:** the JSI crypto module is a new native dependency — state the tradeoff in the
  status entry (maintenance, build impact, what happens if it is abandoned upstream) per the standing
  rule. M9 covers this.
- **Verification:** downloaded audio plays in **airplane mode**; the file on disk is not playable by an
  external tool (encryption is real, not a rename); an interrupted download surfaces the failure and
  recovers on Retry; a half-written encrypted file never plays as garbage; key loss (app reinstall)
  degrades to "re-download", never to a crash. `security-reviewer` passes on key handling.
- **Status update:** `[MOBILE — W4.5 slice 5 downloads] <agent: mobile-developer>`

### W4.6 — Slice 6: Profile & Settings + tablet two-pane
- **Owner:** `mobile-developer`
- **What:** Profile — avatar, name, email; playback section (default speed, autoplay-next); Library
  rows linking to Notes and History (**no counts**, P8); sign out (per-device, per §A.3 #4);
  Announcements row (P2). **No membership/billing block** (L1). **No notify-on-publish toggle** — push
  is cut (L5) and a dead toggle is worse than no toggle. Tablet: rail + docked player + inline "Your
  notes" panel.
- **Verification:** sign out on one device leaves the other signed in (the per-device half of W0.4,
  proven from the UI); tablet two-pane on a real iPad; optimistic toggles revert on failure.
- **Status update:** `[MOBILE — W4.6 slice 6 profile+tablet] <agent: mobile-developer>`

### W4.7 — Accessibility and polish pass
- **Owner:** `mobile-developer`
- **What:** `accessibilityLabel` on every icon (spec §6 — the source's glyphs carry no accessible
  names by construction), pressed/disabled/focus states on both platforms, dynamic-type check at the
  largest OS setting, and the spec §1.4 motion baseline (download progress animates; tabs and
  transport do not).
- **Verification:** VoiceOver and TalkBack walkthrough of every screen recorded in `status.md`; no
  unlabelled interactive element; layout survives the largest text setting without clipping.
- **Status update:** `[MOBILE — W4.7 a11y pass] <agent: mobile-developer>`

---

# H. Phase 5 — Distribution

### W5.1 — Provision EAS, Apple, Google · **[HUMAN_GATE M10]**
- **Owner:** **Isaac, personally** (same reason as W0.1).
- **What:** EAS Production plan, Apple Developer Program enrolment, Google Play Console registration,
  and a decision on where signing certs, provisioning profiles and the Android keystore live. See §I
  for the standing costs.
- **Verification:** an EAS build runs for both platforms from clean credentials; credential custody is
  written down in `DEPLOYMENT.md`.
- **Status update:** `[MOBILE — W5.1 provisioning] <agent: isaac>`

### W5.2 — Internal distribution build
- **Owner:** `mobile-developer`
- **What:** EAS build profiles (dev / preview / production), TestFlight and Play internal-track
  distribution, crash/error reporting wired to the existing structured-logging posture (correlation id
  on every request the app makes, so a mobile error can be traced to a server log line).
- **Verification:** Isaac installs both builds on his own devices and completes the Definition of Done
  walkthrough.
- **Status update:** `[MOBILE — W5.2 internal builds] <agent: mobile-developer>`

### W5.3 — Documentation
- **Owner:** `scribe`
- **What:** `DEPLOYMENT.md` gains a mobile section (build, credentials, the Glacier restore procedure
  cross-reference, the standing costs, the Isaac-only steps flagged the way §179's Resend note is).
  `plans/README.md` gains this plan's row. `mobile/README.md` for local setup.
- **Verification:** a reader who has never seen the app can get a dev build running from the docs alone.
- **Status update:** `[MOBILE — W5.3 docs] <agent: scribe>`

### W5.4 — Release readiness · **[HUMAN_GATE M11]**
- **Owner:** `security-reviewer` (final pass on the shipped app), then Isaac
- **What:** Final security pass on the built app (what the bundle ships, what the logs leak, token
  storage on a rooted/jailbroken device posture), then Isaac's go/no-go on submission.
- **Verification:** verdict in `status.md`; Definition of Done fully ticked.
- **Status update:** `[MOBILE — W5.4 release readiness] <agent: security-reviewer>`

---

# I. Sequencing — and an honest account of the bottlenecks

Isaac asked for phases "without bottlenecks and complications". **That is achievable for most of the
work and genuinely not achievable for two things.** Rather than smooth that over, here is the real
shape.

## I.1 What runs in parallel (no artificial dependency)

```
M1
├── Track A (backend auth):   W0.3 → W0.4 → W0.5 → M4 ─────────────┐
├── Track B (media):          M2 → W0.2 → M3 → Phase 1 (W1.1-W1.10) → M5
├── Track C (app scaffold):   W0.6 → W3.1 ─────────────────────────┤
└── Track D (backend misc):   Phase 2 (W2.1-W2.5) → M6, M7         │
                                                                    ▼
                                      Phase 3 (W3.2-W3.5) → M8 → Phase 4 slices
```

- **Phase 2 is fully independent of Phase 1.** The rate limiter, notes and episode renumbering share
  no code with the media pipeline. Run them concurrently.
- **Phase 3's theme work (W3.1) needs nothing but the scaffold** — it can start the moment M1 is
  crossed, in parallel with both backend tracks.
- **Four of six Phase 4 slices need no media pipeline at all**: Browse, Search, Series, Announcements,
  Profile. Only Slice 2 (Player) and Slice 5 (Downloads) depend on Phase 1. So the screen inventory
  really can be built incrementally against a partial backend, exactly as the brief hoped.

## I.2 The two real bottlenecks, stated plainly

**1. The media pipeline is a genuine prerequisite to the player, and no amount of sequencing removes
it.** Skeptic and architect converged on this independently. The player is the app's reason to exist;
it cannot be built against a `get_stream` contract that is about to change, and the audio-download
work is meaningless until the endpoint exists. What *is* possible — and what this plan does — is keep
that dependency confined to two of six slices instead of gating all of Phase 4 behind it. What is not
possible is building the player early and retrofitting Stream; that is the version of "no bottleneck"
that costs more than it saves.

**2. The auth rework gates more than it looks like it does.** It is not just "needed for tablet". Until
W0.4 lands, *any* sign-in from the app evicts Isaac's own admin-portal session, and two test devices
cannot coexist. So it gates all on-device auth testing, which means it gates Phase 3, which means it
gates Phase 4 — a wider blast radius than the media work. It is also the cheapest item on the critical
path, which is why it starts at M1 in parallel with everything else.

## I.3 Bottlenecks that are structural, not schedule-fixable

- **Gate latency.** Eleven gates, one human approver. If each waits a day, that is eleven days of
  calendar with nobody working. Mitigations built into the plan: M5 merges the schema and contract
  changes into one review; M6 and M7 are explicitly batchable; M2 and M10 are errand lists Isaac can
  do in one sitting each. **This is the plan's single largest non-engineering cost and it cannot be
  engineered away** — gates are gates.
- **Agent concurrency is not wall-clock concurrency.** The tracks above are free of *dependencies*;
  whether they run simultaneously depends on how many executors the Conductor runs at once and on
  review bandwidth. The plan is parallel-*capable*; do not read the diagram as a schedule.
- **The catalogue has no Stream content until W1.9 runs.** Slice 2 cannot be meaningfully tested
  before the backfill. That is why W1.9 is a work item in Phase 1 rather than an ops afterthought.

## I.4 Known risks carried, not solved

| Risk | Posture |
|---|---|
| `GET /sermons` is unpaginated (`app/api/catalog.py:24`) and Home loads it on every cold start | Accepted for MVP. Trigger for revisiting: >200 published sermons or a payload >150 KB. Pagination is a public-API change and would need its own gate — deliberately not taken on now. |
| W0.2's spike fails on item 1 | M3 exists precisely for this. A fail re-opens the media decision; it does not get worked around in the player. |
| Deep Archive restores take hours | Documented in W1.4, not mitigated. The archive is insurance against vendor loss, not a hot backup. |
| No push notifications (L5) means no "new sermon" re-engagement | Accepted product cut. The notify-on-publish toggle is removed rather than shipped dead (W4.6). |
| One Expo codebase, three chromes, one implementer | The per-slice review cadence is the control. If Android M3 parity starts slipping behind iOS inside a slice, that is a halt-and-report condition, not something to catch up on later (L3 makes parity a requirement, not a preference). |

---

# J. Standing costs and Isaac-only steps

**Recurring, not one-time — these are commitments, not setup:**

| Item | Cost | When first needed |
|---|---|---|
| Cloudflare Stream | usage-based (storage per minute + delivery) | M2, before the spike |
| S3 Glacier Deep Archive | usage-based, small; **restore costs money and takes hours** | Phase 1 |
| EAS Production plan | ~$99/mo | M10 (deferrable: dev builds can be built locally at no cost until distribution) |
| Apple Developer Program | $99/yr | M10, for TestFlight |
| Google Play Console | $25 one-time | M10 |
| Credential management | permanent operational surface — signing certs, provisioning profiles, keystores, renewals | from M10 forever |

**Planner's note on timing:** the EAS and Apple costs are deliberately placed at M10, not M2. Local
dev builds (`npx expo run:ios` / `run:android`) need neither, and the W0.2 spike can run on a free
Apple ID's 7-day development profile. Paying $99/mo from day one buys nothing until there is something
to distribute.

**Steps only Isaac can perform** (flagged the way `DEPLOYMENT.md:179` flags Resend domain
verification — account creation, billing and credential custody are not things this codebase or its
agents can do on his behalf): **W0.1** and **W5.1**.

---

# K. Rollback

Per phase, because the phases fail differently:

- **Phase 0 auth (W0.4):** revert the commit; `alembic downgrade` one revision if `user_sessions`
  landed. Single-slot behaviour returns — degraded but functional, which is today's state. The one
  thing that must not be rolled back halfway: a revert that keeps per-device logout while restoring
  single-slot storage would silently un-fix the revocation paths. Revert whole or not at all.
- **Phase 1 media:** `stream_uid` is nullable and additive, so the old presigned-S3 path can be
  restored by reverting `media_service` without touching the schema. **The S3 masters are the reason
  this is reversible at all** (§A.2) — which is L8's whole point. Cloudflare Stream content can be
  re-ingested from S3 at any time; it cannot be reconstructed from Stream if the masters are gone.
- **Phase 2:** each of W2.1/W2.2/W2.3 reverts independently. `sermon_notes` is a new table —
  `downgrade` drops it and **destroys user-authored notes**, so once real notes exist, a revert is a
  data-loss event and needs Isaac's explicit sign-off, not a routine rollback.
- **Phase 3/4 app:** no server state; revert the branch. The app is not yet published, so there is no
  installed-base consequence — **this stops being true at M11**, after which a bad release is an
  App-Store-review-latency problem with no hot-patch. That asymmetry is why M11 exists.
- **Phase 4 Slice 5 (downloads):** removing the feature orphans encrypted files in app-private
  storage. Ship the delete path in the same slice as the download path so a rollback can clean up.

---

# L. Out of scope — nothing here ships

Transcripts · scripture cross-references · clip-share · a Saved/bookmarks tab · follow-a-series · push
notifications · a download storage-quota manager · paid-tier anything (paywall, IAP, preview gates,
membership/billing, PAID badge) · **video** downloads · server-side download registry or cross-device
quota · unpublished-episode-gap disclosure · Profile aggregate counts · a phone Series tab · a sixth
phone tab · a general-purpose "notice" component · pagination of `GET /sermons` · web player changes
beyond W1.8's reviewer-preview fix · any CDN_BASE_URL enablement.

---

# M. Amendments

### 2026-09-22 — W0.2 spike runs on simulators, not real hardware; GATE M11 gains a condition

**Reason**: no real Android device was available at the time W0.2 was ready to run; Isaac elected to
proceed on iOS Simulator + Android emulator via Expo rather than wait on hardware procurement.

**What changes**:
- W0.2 executes against simulators/emulators, not real iOS/Android hardware as originally specified.
  Four of its five checks (Stream HLS playback, backgrounded/resumable downloads, the JSI crypto
  round-trip, lock-screen/notification controls) are treated as genuine results from a simulator run —
  worth noting explicitly that iOS Simulator has a materially weaker track record than real hardware
  for background-audio-while-locked and Control Center integration, so a clean simulator result there
  is a good sign, not full confidence.
- **Item 5 (decrypt-to-first-audio latency, the datum P7 depends on) is explicitly NOT trusted from a
  simulator.** A simulator runs on host CPU, not real mobile silicon, and P7 was designed to be
  answered by measuring the *oldest target device* specifically — a simulator number is likely
  artificially fast and could wrongly conclude no "Preparing…" state is needed. The simulator run
  still produces a number and a provisional P7 call, but both are marked provisional pending real
  hardware.
- **New condition on GATE M11** (release readiness): a real-device confirmation pass — at minimum the
  decrypt-latency measurement (item 5) re-run on real, ideally older/lower-end, iOS and Android
  hardware — must happen and be recorded in `status.md` before M11 can be considered satisfied. If the
  real-device latency contradicts the simulator-driven P7 call, the "Preparing…" state (or its absence)
  must be revisited before submission, not shipped on the provisional call.
- GATE M3 itself is still crossed by a clean simulator run on the other four checks plus a provisional
  item 5 — it is not blocked waiting for real hardware. Only M11 gains the new condition.
