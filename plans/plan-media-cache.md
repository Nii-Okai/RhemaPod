# Plan: Mobile media cache — Phase 1 (streamed audio LRU)

Design source of truth: Isaac's binding decisions and the architect's hook-point confirmation for media
cache Phase 1. The decisions file lives in a session scratchpad and will not survive, so everything it
binds is restated in §A. **§A is binding.** Changing any row is a plan amendment, not an executor's call.

Execution log: the append-only root `status.md`, never this file. Every step names the entry it
appends: a heading `## MEDIA-CACHE — <step id> <short title>` followed by the line
`[MEDIA-CACHE — <step id> <short title>] <agent: …> <ISO-8601 UTC timestamp>`, then the body.
Nothing is logged to `status.md` until `[HUMAN_GATE G0]` is crossed.

Branch: `feat/media-cache` off `dev` (Step S0). One controlled merge back into `dev` at `[HUMAN_GATE G3]`.

Executors halt **only** at gates. Between gates they run to the step's acceptance criteria. If reality
diverges from this plan (an anchor below has moved, a primitive cannot be shared without changing
Downloads behaviour, a native API is missing), the executor stops, writes `HALTED: <reason>` in its
status entry, and the Conductor decides whether to amend.

---

## Goal

A streamed, non-HLS sermon the user has partly listened to is silently cached to disk on Wi-Fi, and
the next play of it re-validates through `/stream` and then plays the local file — inside a bounded,
self-evicting, sign-out-wiped cache that never touches Downloads.

## Scope

- **In:** a disposable, silent LRU disk cache for streamed **audio** (and, incidentally, any
  non-HLS progressive video — expected rare or none). Mobile app only (`mobile/`).
- **HLS limitation (permanent for Phase 1, not a TODO):** Cloudflare Stream video resolves to an HLS
  `.m3u8` URL (`_resolve_variant_url` in `app/services/media_service.py`). The cache-key function
  returns `null` for `.m3u8` and non-http(s) URLs; those sermons stream exactly as today. No error
  path, no player special-casing.
- **Downloads is unchanged and remains the only durable, encrypted, offline-guaranteed path.** The
  cache is not offline playback: every hit re-validates through `/stream` first.
- **Out (separate future plans):** backend `Cache-Control`/ETag/CDN work; `expo-image` adoption and
  the downloaded-thumbnail expiry bug; any Expo SDK bump; any backend, migration or public-API change.

## Definition of Done

- [ ] A non-HLS sermon exited at 5–90 % progress on Wi-Fi is filled to the cache; the next open of it
      calls `/stream`, gets 200, and plays the local file (on-device, S4).
- [ ] A cache hit whose `/stream` call fails (403 paywall, 404 takedown/unpublish, offline) does not
      play the local file; the existing player error path shows (jest, S4).
- [ ] An HLS sermon never produces a manifest row or a file and plays as before (jest + on-device, S4).
- [ ] Fills respect `wifiOnly` from `loadDownloadPreferences()`; with Wi-Fi-only off, fills run on
      cellular (jest, S3).
- [ ] Cache size stays ≤ quota = `min(2 GB, 10 % × (free + cache bytes))`, honouring the 1.5 GB
      free-space floor and the ~50 %-of-quota single-item skip; LRU evicts oldest `last_accessed_at`
      first; the playing and mid-write entries are never evicted (jest + on-device forced-small
      quota, S5).
- [ ] The startup sweep drops rows whose file is missing or wrong-sized and deletes orphan `.part`
      and row-less files (jest + on-device, S5).
- [ ] When a Download reaches `ready`, that sermon's cache entry is deleted and any in-flight fill for
      it is cancelled (jest + on-device, S6).
- [ ] Every path through `clearSession()` (voluntary sign-out, both forced sign-out paths) wipes cache
      files and the manifest, cancels any in-flight fill, and leaves Downloads intact (jest +
      on-device, S7).
- [ ] No presigned URL, query string or token appears in the manifest, a file name, or any log line
      (jest assertion on manifest rows and captured logs, S2/S3; security review, S9).
- [ ] No new dependency in `mobile/package.json`. No change under `app/`, `alembic/`, `openapi.json`
      or `mobile/lib/api/schema.d.ts`. No change to the Downloads SQLite schema.
- [ ] `npm run test`, `npm run typecheck`, `npm run lint` green in `mobile/` at G3.
- [ ] `reviewer-gilfoyle` (S8) and `security-reviewer` (S9) signed off in `status.md`.
- [ ] ADR recording the "plaintext cache / encrypted Downloads" boundary exists in `docs/adr/` (S10).
- [ ] §Test strategy filled by `qa-strategist` and every case it lists is green.
- [ ] **No scope creep.** Nothing in §Scope "Out" ships.

---

# A. Binding design (restated)

## A.1 Locked decisions

| # | Decision | Source |
|---|---|---|
| D1 | **At-rest: plaintext** for cached media. Signed off again at `[HUMAN_GATE G1]`. | Isaac |
| D2 | **Encryption is exclusive to Downloads.** The cache never uses `rpa-crypto`, `installKey`, the RPA1 format or `rpa-playback-tmp/`; Downloads never reads the cache. A cached file is a disposable plaintext copy of bytes the user was already streaming; the M9 "not playable by an external tool" guarantee applies to Downloads only and is not extended to, or weakened by, the cache. | Isaac |
| D3 | **Fill trigger:** fill only when the user leaves a sermon with progress in `[5 %, 90 %]`. | Isaac |
| D4 | **Network policy:** reuse Downloads' Wi-Fi-only toggle (`wifiOnly`, `mobile/lib/settings/downloadPreferences.ts`). No separate cache setting. | Isaac |
| D5 | **Sign-out wipe:** `clearMediaCache()` wipes cache files + manifest on sign-out / account switch, from `mobile/lib/auth/session.ts`. Downloads untouched. Gated at `[HUMAN_GATE G2]`. | Isaac |
| D6 | No demand-validation step. Build it. | Isaac |
| D7 | **Background mechanism:** expo-file-system legacy `createDownloadResumable` (default `sessionType` BACKGROUND → iOS background `URLSession`), shared with Downloads' `realDownloadToFile` (`mobile/lib/downloads/downloadManager.ts:68-80`) by export/injection, not copy. **No new entitlement or `UIBackgroundModes` entry is needed** (Info.plist has `audio` only and the cache must not rely on it). The conditional new-entitlement gate therefore does not exist in this plan. | Architect |
| D8 | Hand-rolled cache. expo-video 2.0.6 (SDK 52) has no native caching API. No SDK bump. | Architect |
| D9 | **Cache key = `MediaRef.id`** (`SermonDetail.media_refs[].id`, a server UUID). The selected `StreamVariant` is matched to its `MediaRef` by `type` (one rendition per type). Reprocessing deletes and reinserts the `MediaRef` → new id → replaced media ages out by LRU. Zero backend changes. | Architect |
| D10 | **Manifest:** a dedicated expo-sqlite DB file `rpa-media-cache.db`, separate from the Downloads DB and schema. | Architect |
| D11 | **Every hit calls `/stream` first** (entitlement, takedown, unpublish) before the player source is swapped to the local file. A hit never grants offline playback. | Converged default |
| D12 | **Path hygiene:** opaque file names derived from `MediaRef.id`, never raw server strings. Never persist presigned URLs, query strings or tokens in the manifest or file names; never log them. | Converged default |
| D13 | **Atomic writes:** download to `<name>.part`, verify size against the response `Content-Length`, rename only after verification. | Converged default |
| D14 | **Startup sweep:** the cache's own single-flight sweep on first cache access (not inside Downloads' `startupSweep()`): drop rows whose file is missing or wrong-sized; delete orphan `.part` and row-less files. | Converged default + architect |
| D15 | **Quota:** `min(HARD_CEILING, 10 % × (free bytes + current cache bytes))`; `HARD_CEILING = 2 GB`; never fill below a 1.5 GB free-space floor; skip any single item > ~50 % of quota. Tunable constants in one module. | Converged default |
| D16 | Never evict the currently playing or mid-write file. Single-flight fill: a newer fill request cancels the older one. | Converged default |
| D17 | **Location:** own subfolder `rpa-media-cache/` under `FileSystem.cacheDirectory`, distinct from `rpa-playback-tmp/` and `rpa-download-tmp/`. | Converged default |
| D18 | **Downloads wins:** after `db.markReady` in the download manager (`downloadManager.ts:225` audio, `:270` video — not in `db.ts`), delete that sermon's cache entry and cancel any in-flight fill for it. | Converged default + architect |
| D19 | No new dependencies (expo-sqlite, expo-file-system, expo-network already installed). No backend, migration or public-API change. | Converged default |

## A.2 Hook points (verified against `dev` @ `d2df893` at planning time; S0 re-verifies)

| Concern | Anchor |
|---|---|
| Player | `mobile/app/player/[id].tsx` — `useStream(sermonId, { enabled: … && !isDownloaded })` (:199), `selectPlaybackVariant` (:272), `useVideoPlayer` mounted after detail/progress/stream/preferences resolve (:292) |
| Transfer primitive | `realDownloadToFile` `mobile/lib/downloads/downloadManager.ts:68` (not exported) |
| Wi-Fi gate | `realCanStartDownload()` `downloadManager.ts:96` (not exported), composed from `loadDownloadPreferences()` (`downloadPreferences.ts:36`) and `isOnWifi()`/`networkCanStartDownload` (`mobile/lib/downloads/network.ts:10-13`) |
| Downloads-wins | `deps.db.markReady(...)` `downloadManager.ts:225`, `:270` |
| Sign-out | `clearSession()` `mobile/lib/auth/session.ts:53`; called by `signOut()` (:129, call at :142) and forced sign-out on refresh failure (:162, :180) |

## A.3 Planner resolutions (made here, shown to Isaac at the named gate)

| # | Resolution | Gate |
|---|---|---|
| P1 | **"Leaving a sermon"** = the player screen for that sermon unmounts or its `id` changes. Backgrounding the app with the player still mounted is not a qualifying exit. Progress = `currentTime / duration` at that moment. | Confirmed by Isaac |
| P2 | **Fill URL:** the fill uses the variant URL from the `/stream` response already held by the player. If that response is past `expires_in` minus a 5-minute margin, the fill is skipped (the next qualifying exit retries). No extra `/stream` call for fills. | G0 |
| P3 | **Opaque file name:** `MediaRef.id` is a server UUID. The key function accepts only a strict UUID (else returns `null`), and the file name is `<uuid-lowercase>.<ext>` with `<ext>` from a fixed allow-list keyed by media type. This satisfies D12 without a hashing dependency (none is installed; adding one violates D19). | G0 |
| P4 | **Expected size** for D13 comes from the transfer's response `Content-Length`. If absent, the fill is discarded (no row written). | G1 |
| P5 | **Hit path:** a hit is only used if the file exists and its size equals the manifest `size_bytes`; otherwise the row is dropped and the player streams. A hit updates `last_accessed_at`. A hit never triggers a fill on exit. | G0 |
| P6 | **Wipe semantics:** `clearMediaCache()` cancels any in-flight fill, bumps an in-memory generation counter so a fill started before the wipe cannot commit a row after it, closes the manifest DB, deletes `rpa-media-cache/` recursively and deletes `rpa-media-cache.db`. Best-effort: it never throws into `clearSession()`; a failure is reported via the `__DEV__` event log only. | G2 |
| P7 | **Observability:** a `__DEV__`-only `console.info` event stream from the cache module (`hit`, `miss`, `fill-start`, `fill-commit`, `fill-skip:<reason>`, `evict`, `sweep`, `wipe`) carrying event name, `sermonId` and `MediaRef.id` only — never a URL. This is how on-device checks observe hit/miss. Not shipped in release builds. | G0 |
| P8 | Hit/miss is exercised on device (S4) **before** quota and eviction exist (S5). Between S4 and S5 the cache is unbounded on the branch only; nothing merges before G3. | G0 |

## A.4 Assumptions and known limits (accepted for Phase 1; not TODOs)

- **Paid-tier paywall exists.** `_authorize_stream_access` returns 403 for `ContentTier.PAID` without a
  subscription, contradicting the original "all media open to any authenticated user" premise. It does
  not change this design: every hit re-validates via `/stream` (D11), so a lapsed subscriber's hit
  falls through to the existing error path.
- **Background-kill fill loss.** JS completion (size verify, `.part` rename, manifest insert) runs only
  when JS resumes. If iOS kills the suspended app, the fill is lost; the orphan `.part` is cleaned by
  the sweep and the next qualifying exit retries. A swipe-kill cancels the transfer.
- **Wi-Fi checked at start only.** A mid-transfer drop to cellular may continue on cellular — the same
  exposure Downloads already has.
- **Wi-Fi-only off ⇒ cellular fills.** Literal reuse of `wifiOnly` (D4) means a user who turned
  Wi-Fi-only off gets cache fills on cellular. Surfaced here for approval at G0.
- **HLS sermons are never cached.** Any sermon whose selected variant is `.m3u8` streams as today.
- **No new entitlement.** Architect confirmed D7 needs no new background mode or entitlement; there is
  no new-entitlement gate. If S3 finds otherwise, that is a halt and an amendment, not a silent add.

---

# Test strategy

## T.0 What runs where (stated plainly)

- **Real SQLite does not run in Jest.** `jest-expo` runs in the node environment and `expo-sqlite` is native, so there is no engine to load. This is the same constraint `mobile/lib/downloads/__tests__/db.test.ts` documents in its header.
- **Today's pattern.** `jest.mock('expo-sqlite', …)` returns a hand-written in-memory fake of `execAsync`/`runAsync`/`getFirstAsync`/`getAllAsync`. It keys off the SQL shapes the module issues. `network.test.ts` mocks `expo-network` the same way. `downloadManager.test.ts` uses fully injected deps (`makeFakeDb`, `makeFakePaths`, `makeHarness`), so it mocks no native module directly.
- **Reuse that pattern.** Do not add `better-sqlite3` or any other dependency (D19). Isaac's no-mock-the-DB rule is about backend Postgres. For mobile the honest equivalent is "fake the narrowest seam, then prove the real engine on device".
- **What the fake cannot prove, so the device checklist must.** It cannot show that the real SQLite engine accepts the manifest's DDL and SQL strings, or the `rpa-media-cache.db` file lifecycle (open, close, delete during wipe). It also cannot prove real `createDownloadResumable` background behavior, real `Content-Length` from R2, real `getFreeDiskStorageAsync`, or real rename and size semantics.
- **Design rule for testability.** Every module takes injected deps: `fs` (exists, size, move, delete, list, mkdir), `transfer`, `network`/`canStart`, `freeBytes`, `now`, `manifest`. This matches `downloadManager.test.ts` (`makeHarness`). Modules should not import `expo-file-system` directly except in a thin `fsDeps.ts` default, so unit tests need no module mocks beyond `expo-sqlite` for `manifest.ts`.
- **In-memory fake FS.** One shared test helper, `mediaCache/__tests__/helpers.ts`, with a `Map<path, size>` fake. It is used by key/paths, fill, evict, sweep and wipe tests.
- **Time.** Inject `now()`. No real timers. LRU tests must not rely on equal timestamps.

## T.1 Risk-driven coverage map

| Risk | Layer | Why |
|---|---|---|
| Entitlement bypass: a hit plays a local file when `/stream` fails (D11) | Jest on the hook, with a mocked `/stream` result | The highest-impact bug. Pure decision logic, so unit level is enough. |
| Presigned URL or token leaks to the manifest, file name, or logs (D12) | Jest assertions on rows, paths and captured `console.info`/`console.*` | Mechanical and cheap to assert. |
| Corrupt or partial file served as a hit (D13, P4, P5) | Jest with fake FS and transfer, then device | Fail-closed logic is unit-testable. Real `Content-Length` needs the device. |
| Resurrected entry after wipe (race, K1, P6) | Jest with a deferred-promise transfer | Needs deterministic interleaving, which only injected deps give. |
| Eviction removes the playing file or a mid-write file (D16) | Jest | Pure ordering plus pin set. |
| Quota math wrong, disk fills (D15) | Jest, pure function | Numeric boundaries. |
| Downloads regression from exporting shared primitives (S3) | The existing `downloadManager.test.ts` and `network.test.ts`, unmodified | Regression guard, no new code. |
| The manifest's SQL is invalid on the real engine | Device only | Fake SQLite cannot catch it. |
| Background transfer actually completes after backgrounding (D7) | Device only | iOS behavior. |
| HLS sermon regresses | Jest for key and hook, device for playback | Both layers needed. |

## T.2 Unit tests (Jest), per module

All tests live next to the module in `mobile/lib/mediaCache/__tests__/`. Step ownership is in column 1.

### key.ts (S1)

| Step | Case |
|---|---|
| S1 | audio ref plus mp3 URL returns `{mediaRefId, fileName}`, with the file name `<uuid-lowercase>.<ext>` and the ext from the allow-list |
| S1 | uppercase UUID is normalized to lowercase |
| S1 | `.m3u8` returns null; `.m3u8?token=…` returns null; `.M3U8` returns null |
| S1 | `file://`, `data:`, `blob:`, empty string and malformed URL return null |
| S1 | `http://` and `https://` accepted |
| S1 | non-UUID id (empty, `123`, a UUID with a suffix or extra characters, path-traversal `../x`) returns null |
| S1 | no `MediaRef` matching the variant `type` returns null |
| S1 | two refs of different types pick the one matching `type` |
| S1 | the file name never contains `?`, `/`, `%`, `..`, or any substring of the URL (property-style over a few hostile inputs) |
| S1 | an unknown media type has no allow-listed ext and returns null |

### paths.ts and constants.ts (S1)

| Step | Case |
|---|---|
| S1 | the dir is `cacheDirectory + 'rpa-media-cache/'` and differs from `rpa-playback-tmp/` and `rpa-download-tmp/` |
| S1 | the `.part` path is the file path plus `.part` |
| S1 | the web guard returns safely, matching `downloads/paths.test.ts` |
| S1 | constants snapshot-free assertions: window is `[0.05, 0.90]`, ceiling is 2 GB, floor is 1.5 GB |

### manifest.ts (S2, with the `expo-sqlite` fake)

| Step | Case |
|---|---|
| S2 | insert then get round-trips all fields |
| S2 | insert of a duplicate `media_ref_id` replaces or updates the row, with no duplicate |
| S2 | touch updates `last_accessed_at` only |
| S2 | `deleteByKey` and `deleteBySermon` (several rows for one sermon) |
| S2 | `listByLru` orders ascending by `last_accessed_at`, with a deterministic tie-break |
| S2 | `totalBytes` is the sum, and 0 when empty |
| S2 | `close()` then reopen works |
| S2 | schema assertion: no column name contains `url`, `token` or `query` |
| S2 | opens only `rpa-media-cache.db`; `rpa-downloads` is never referenced |

### quota.ts (S5, pure)

| Step | Case |
|---|---|
| S5 | `min(2 GB, 10% × (free + cache))` where the 10% branch wins |
| S5 | the ceiling wins when free is large |
| S5 | feedback-loop check: filling the cache raises neither quota nor free-space illusion (cache bytes counted back in). With the same total (free + cache), quota is identical before and after a fill |
| S5 | free below the 1.5 GB floor means the fill is refused (quota 0 or skip) |
| S5 | free exactly at the floor, and at floor minus 1 byte (boundary) |
| S5 | item size exactly 50% of quota is allowed, and 50% plus 1 byte is skipped |
| S5 | zero or negative free-space input is clamped and does not throw |
| S5 | constants overridden via injection change the outcome |

### evict.ts (S5)

| Step | Case |
|---|---|
| S5 | evicts oldest `last_accessed_at` first, until total ≤ quota |
| S5 | touched entry survives over an older untouched one |
| S5 | pinned playing entry is skipped even if it is the oldest |
| S5 | mid-write entry is skipped |
| S5 | when only pinned entries remain and the cache is still over quota, it stops without looping and without throwing |
| S5 | row is deleted and then the file; a missing file on delete is tolerated |
| S5 | a file delete failure leaves a consistent state (the row is not left pointing at nothing without being retried by the sweep) |
| S5 | nothing is evicted when under quota |
| S5 | emits `evict` with ids only |

### fill.ts (S3, then S5 additions)

| Step | Case |
|---|---|
| S3 | happy path: transfer to `.part`, size equals `Content-Length`, rename, manifest insert, `fill-commit` |
| S3 | size mismatch: no row, `.part` deleted |
| S3 | missing or zero `Content-Length`: no row, `.part` deleted (fail closed, P4) |
| S3 | transfer throws: `.part` deleted, no row, no rethrow into the caller |
| S3 | rename throws: `.part` deleted, no row |
| S3 | manifest insert throws: the file is deleted |
| S3 | expired URL (`expires_in` minus 5 min margin): skip, no network call. Boundary at exactly the margin and at margin minus 1 s |
| S3 | Wi-Fi gate: `wifiOnly` on + cellular is `fill-skip:network`; `wifiOnly` on + Wi-Fi fills; `wifiOnly` off + cellular fills (D4 literal reuse) |
| S3 | the gate is called with the same primitives and not a copy: `fill.ts` consumes the exported `realCanStartDownload` (or composed primitives) through an injected dep |
| S3 | single-flight: the second `requestFill` cancels the first (transfer cancel called, first `.part` deleted, no commit from the first); the first resolving late does not commit |
| S3 | `cancelFill(sermonId)` cancels only a matching in-flight fill; `cancelFill()` cancels any |
| S3 | no URL substring in the manifest row, the file name, or any captured log, across success and every failure path above |
| S5 | free-space floor and 50%-of-quota item skip each emit `fill-skip:<reason>` with no transfer started |
| S5 | evict runs after `fill-commit`; a failure in evict does not undo the commit |
| S5 | fill never evicts its own just-written entry |

### sweep.ts (S5)

| Step | Case |
|---|---|
| S5 | row with the file missing: row dropped |
| S5 | row whose file size differs from `size_bytes`: row dropped and file deleted |
| S5 | orphan `.part`: deleted |
| S5 | row-less final file: deleted |
| S5 | consistent row and file: untouched |
| S5 | empty dir and missing dir: no throw |
| S5 | single-flight: concurrent first-access calls run the sweep once (the fs list call count is 1), and the second caller awaits the same promise |
| S5 | a sweep failure does not block cache access (best effort) |
| S5 | the sweep does not run again within the same launch |
| S5 | the sweep never touches `rpa-download-tmp/`, `rpa-playback-tmp/` or Downloads files |

### useCachedSource.ts (S4)

| Step | Case |
|---|---|
| S4 | miss: source is the stream URL, `miss` event |
| S4 | valid hit (file exists and size matches): local `file://` source, touched and pinned |
| S4 | hit with `/stream` 403, 404 or network error: no local source, the existing error path is used |
| S4 | hit where the file is missing or the size is wrong: row dropped, falls back to streaming, no throw |
| S4 | HLS variant: no manifest lookup, no fill, no events |
| S4 | `isDownloaded` true: the hook is inert |
| S4 | exit progress boundaries: 4.9% no fill, 5.0% fill, 90.0% fill, 90.1% no fill, 0% and 100% no fill, `duration` 0 or NaN no fill |
| S4 | exit at 50% on a miss: `requestFill` called exactly once |
| S4 | exit on a hit: no fill (P5) |
| S4 | `id` change on the player route counts as an exit for the old sermon (P1); app backgrounded with the player mounted does not |
| S4 | the pin is released on unmount |

### clearMediaCache (S7)

| Step | Case |
|---|---|
| S7 | wipe cancels the in-flight fill, closes the DB, deletes the dir and the DB file, in that order |
| S7 | generation counter: a fill started before the wipe whose transfer resolves after the wipe commits no row, creates no file, and deletes its `.part` |
| S7 | a fill started after the wipe works normally (generation re-read) |
| S7 | wipe called twice, or with nothing to delete, is idempotent |
| S7 | a dir delete failure is swallowed, never thrown, and logged only as a dev event |
| S7 | a wipe during an active sweep does not leave rows behind |
| S7 | Downloads DB and `rpa-downloads/` are never referenced |
| S7 | `session.ts` tests: `signOut()`, forced sign-out at both refresh-failure sites (:162, :180) each invoke the wipe via `clearSession()`; a throwing wipe still clears the tokens; the wipe is called once per path |

### Downloads-wins hook (S6)

| Step | Case |
|---|---|
| S6 | after `markReady` (audio path) the injected dep gets `deleteBySermon(id)` and `cancelFill(id)` |
| S6 | the same for the video path (:270) |
| S6 | the dep throws: the download still ends `ready` and no error is surfaced |
| S6 | order: the hook runs after `markReady`, never before it, and never on a failed or cancelled download |
| S6 | `downloadManager.test.ts` default harness passes a no-op dep, so existing cases are unaffected |
| S6 | the cache file is actually removed through the fake FS (the row and the file both gone) |

### Cross-cutting: no URL or token anywhere

A single shared assertion helper, `expectNoSecrets(manifestRows, paths, consoleSpy)`. It is called at the end of the S2/S3/S4/S5/S7 happy and failure cases, using a URL containing a recognizable `X-Amz-Signature=SECRET123` marker. Fail if the marker or the host appears in any manifest row, path string, or `console.*` call argument.

## T.3 Integration seams

| Seam | How it is tested | Acceptance |
|---|---|---|
| Shared transfer function (`realDownloadToFile`) export (S3) | Run the existing `downloadManager.test.ts` unmodified. The tests inject fakes, so they prove the manager's logic is unchanged. Add one small test that the export has the same signature as the injected `downloadToFile` type (compile-time via typecheck). | Test file has zero diff and is green. `git diff` of the export shows only an `export` keyword or a pure move. |
| Wi-Fi gate export (`realCanStartDownload`) | Run `network.test.ts` unmodified. Add one test for the exported function composing `loadDownloadPreferences()` and `isOnWifi()`: four combinations of wifiOnly × network. | Behaves identically to the pre-change composition. |
| The honest gap | `createDownloadResumable` and the real gate use real native modules, so the Jest tests prove composition and not iOS behavior. | Covered by device items V1, V8, V9, V10. |
| Regression guard | At each of S3, S6, S7 and G3: `npm run test` must show the same count of Downloads tests as the S0 baseline. S0 records the baseline counts. | Counts equal or higher, never lower. |
| `session.ts` | Existing auth/session tests (if present) pass unmodified besides the new wipe dep. | Only one added call. |

## T.4 On-device checklist (physical iPhone, Expo dev client)

**Setup.** Dev build installed. Metro console open (the `__DEV__` event log appears as `console.info`). Use a non-HLS audio sermon, call it A, and a second one, B. Use one HLS video sermon, V. Signed in as a user with access. Wi-Fi-only setting: ON unless stated. Expect events named `hit`, `miss`, `fill-start`, `fill-commit`, `fill-skip:<reason>`, `evict`, `sweep`, `wipe`, each carrying sermonId and MediaRef.id only.

Also run the baseline from S0 first: A streams.

| # | Item | Steps | Expected observation | Step owner |
|---|---|---|---|---|
| V1 | Miss, fill, hit | 1. Fresh install or cache wiped. 2. On Wi-Fi, open A, listen past 5% (and under 90%). 3. Leave the player. 4. Watch the log. 5. Reopen A. | Step 4: `miss`, then `fill-start`, then `fill-commit` within a reasonable time, and no URL in any line. Step 5: a `/stream` request is visible (network/log) before `hit`; playback starts from the local file. Also confirms real `Content-Length` is present (K4); if `fill-skip` or no commit occurs, halt per K4. | S4 (a)(b) |
| V2 | Hit re-validates `/stream` | 1. With A cached, open A with the backend `/stream` request observable (server log or proxy). 2. Reopen A. | `/stream` is called on every open, and only after its 200 does playback switch to the local file. Log order: stream call, then `hit`. | S4 |
| V3 | Airplane mode does NOT play offline | 1. A is cached but not downloaded. 2. Enable airplane mode. 3. Open A. | The existing player error UI shows (no playback), and no `hit` event leads to playback. Local file remains on disk but unused. Then disable airplane mode and reopen: plays from cache. | S4 |
| V4 | Entitlement failure on hit (best effort) | If you can, make `/stream` return 403 or 404 for A (unpublish A in a dev backend, or a non-subscribed account on a paid sermon). Open A. | Error UI. Local file not played. | S4 |
| V5 | Eviction under a lowered quota | 1. Local, uncommitted edit: set the hard ceiling to just above one item's size. 2. Fill A, then B (each exits within 5 to 90%). 3. Read the log. 4. Reopen A. 5. Revert the edit. | `evict` for A (oldest), after B's `fill-commit`. A's next open is a `miss`. B opens as a `hit`. B was never evicted while playing. `git diff` on `constants.ts` is clean afterwards. | S5 |
| V6 | Playing entry not evicted | With the same lowered quota, hold B open (playing) and trigger another fill of A. | No `evict` of B; if the quota cannot be met, the fill is skipped or the cache is temporarily over quota, with no crash. | S5 |
| V7 | Sign-out wipe, and Download survives | 1. Cache A. 2. Download B fully (ready). 3. Sign out. 4. Check the log. 5. Sign back in. 6. Open A and B. | Step 4: `wipe`. Step 6: A is a `miss`. B plays via Downloads (offline-capable, check by airplane mode). Downloads list unchanged. | S7 |
| V8 | Forced sign-out | 1. Cache A. 2. Force a refresh failure: revoke the refresh token on the server (or expire it) and trigger a call that refreshes. 3. Observe the app returning to the signed-out state. 4. Check the log. 5. Sign in again. | `wipe` logged on the forced path; A is a `miss` afterward. Do this for both refresh-failure sites if each is reachable; if not, record which one was exercised and that the other is covered by jest only. | S7 |
| V9 | Downloads wins | 1. Cache A (V1). 2. Start a Download of A and wait for ready. 3. Check the log, and open A. | Cache entry for A removed (log shows the removal), no fill in flight for A; A plays through the Downloads path (`useLocalPlayback`) with no cache events. | S6 |
| V10 | Downloads wins mid-fill | Start a fill for A, then immediately start a Download of A. | The fill is cancelled, no orphan `.part` after the next sweep, Download completes normally. | S6 |
| V11 | HLS untouched | Open V, play to mid-way, leave. | No cache events at all, no row or file under `rpa-media-cache/`, playback and behavior identical to baseline. | S4 (c) |
| V12 | Wi-Fi off, no fill | 1. Wi-Fi-only ON. 2. Turn off Wi-Fi (cellular on). 3. Open a fresh non-HLS sermon C (it streams), listen past 5%, leave. | `fill-skip:network`, no `.part`, no row. Next open is a `miss`. | S4 (d) |
| V13 | Wi-Fi-only OFF fills on cellular | Turn the Downloads Wi-Fi-only setting off, on cellular repeat V12. | `fill-start` then `fill-commit` on cellular. This confirms and documents the D4 consequence for G0. | S3/S4 |
| V14 | Backgrounded mid-fill, then foregrounded | 1. Start a fill (leave A at 50%). 2. Immediately background the app (home). 3. Wait about 1 to 2 minutes. 4. Foreground. 5. Reopen A. | After foregrounding, `fill-commit` appears (JS resumed and finished). Reopen is a `hit`. If iOS killed the suspended app instead, the next launch's sweep removes the `.part` and the next qualifying exit retries. Record which one occurred. | S4 / S3 |
| V15 | Killed mid-fill, sweep cleans the orphan | 1. Start a fill (leave A at 50%) on a large-enough file so it lasts several seconds. 2. Swipe-kill the app mid-transfer. 3. Relaunch and open any sermon (first cache access triggers the sweep). | `sweep` event, and the orphan `.part` is gone (inspect with a dev-only listing or log of files removed). No row exists for A, so it is a `miss`. | S5 |
| V16 | Real SQLite engine accepts the manifest | Implicit in V1. Also confirm there is no error on first open of the cache DB, and that sign-out in V7 removes `rpa-media-cache.db` (next open recreates it). | No SQL errors in Metro. Closing, deleting and recreating the DB works. | S2 / S7 |

Record each result in the matching `status.md` entry. If a device item cannot be exercised, say so plainly and do not mark the step done.

## T.5 Step ownership summary

| Step | Jest cases owned | On-device |
|---|---|---|
| S0 | baseline counts for `npm run test` / `typecheck` / `lint` (the regression reference for Downloads) | baseline streaming of a non-HLS sermon |
| S1 | key, paths and constants cases | none |
| S2 | manifest cases (including the no-url-column schema assertion) | V16 (partly, once wired) |
| S3 | fill cases (fail-closed, single-flight, Wi-Fi gate, expiry, no-URL leakage); the Downloads regression guard | none (not wired yet) |
| S4 | `useCachedSource` cases (entitlement failure, HLS, 5%/90% boundaries, exit on hit) | V1, V2, V3, V4, V11, V12, V13, V14 |
| S5 | quota, evict, sweep, and the fill additions (floor and 50% skip) | V5, V6, V15 |
| S6 | Downloads-wins hook cases | V9, V10 |
| S7 | clearMediaCache, generation counter, `session.ts` paths | V7, V8, V16 |
| S8 | Gilfoyle checks race coverage: fill-commit vs evict vs wipe has a deterministic Jest test (T.2 clearMediaCache, fill, evict) | none |
| S9 | the no-secrets helper is re-run, and security-reviewer checks logs and paths on a device capture | spot check of Metro output for V1/V7 |
| S10 | none | none |

## T.6 Definition of "tested"

- [ ] Happy path covered at each module (key, manifest, fill, evict, sweep, hook, wipe).
- [ ] At least one failure mode per public function (transfer throws, rename throws, manifest throws, wipe throws).
- [ ] Boundaries: 5% and 90% progress, 50%-of-quota item, free space at the floor, the URL-expiry margin, ceiling vs 10% branch.
- [ ] Entitlement negative case: `/stream` 403, 404 and network error with a valid hit never plays the local file.
- [ ] Idempotency: wipe twice, sweep once under concurrent callers, duplicate insert, double `requestFill`.
- [ ] No-secrets assertion green across success and failure paths.
- [ ] Downloads suites unmodified and green with equal or higher counts than the S0 baseline.
- [ ] Device items V1 to V16 recorded with observed outcomes.

## T.7 Acceptable coverage gaps

| Gap | Why acceptable |
|---|---|
| Fake `expo-sqlite` does not validate real SQL | Proven on device in V1 and V16; the manifest SQL is small (one table, a handful of statements). A native SQLite test harness would be a new dependency (D19) for a single table. |
| iOS background `URLSession` completion is not simulated in Jest | Only the device can show it (V14, V15). Jest proves the JS completion logic given a resolved or rejected transfer. |
| Mid-transfer Wi-Fi to cellular drop | Documented limit (A.4), the same exposure as Downloads; not testable reliably. |
| Real R2 `Content-Length` header | Verified by V1; fail-closed behavior is unit-tested, and K4 halts if it is absent. |
| `expo-video` player swapping to the local `file://` source | The hook's decision is unit-tested; actual playback is observed on device (V1, V2). No test of expo-video internals. |
| Quota under real disk pressure and OS cache eviction | The OS can purge `cacheDirectory` at any time. The sweep reconciles it. Not deterministic to test; the D15 behavior is the proxy. |
| Process-kill races between rename and manifest insert | Leave a row-less file, which the sweep removes (unit-tested in sweep). The exact kill timing is not reproducible. |
| UI snapshot tests of the player | Churn without value. The hook is tested instead. |
| Both forced sign-out sites on device | Covered in Jest for both. If only one is reachable on device, record that (V8). |
| Concurrency beyond single-flight (two sermons filling at once) | Single-flight is the design; that case is covered by the "newer cancels older" test. |

## T.8 What not to test

- `expo-file-system`, `expo-sqlite`, `expo-network`, `expo-video` themselves (framework code).
- Exact SQL strings in the manifest. Test behavior through the public functions, so a refactor of the SQL does not break tests.
- Exact event-name ordering beyond the checked sequence (miss, fill-start, fill-commit; wipe; evict).
- Visual or snapshot output of the player.
- Downloads' encryption, key handling or RPA1 format (unchanged; guarded by the existing suites).

## T.9 Smoke for prod (post-merge, before any release build)

- On a release or preview build with `__DEV__` off: stream a non-HLS sermon past 5% on Wi-Fi, leave, reopen. It plays with no visible difference and nothing in the UI mentions caching. The `__DEV__` events are not emitted (confirm by checking no cache output in the device console of the release build).
- Sign out and sign back in, then confirm that an existing Download still plays offline.

---

# B. Steps

Four phases. Owners: `mobile-developer` for production code; `noob-dev` only for mechanical work;
reviewers and `scribe` at close-out. Every step's verification runs, in `mobile/`:
`npm run test`, `npm run typecheck`, `npm run lint` (written below as **the three commands**).
On-device checks use the connected physical iPhone on the Expo dev client and read the P7 event log.

### [HUMAN_GATE G0] — Plan approval
- Isaac approves this plan, including §A.3 resolutions P2, P3, P5, P7, P8 (P1 and the S10 ADR are
  already confirmed by Isaac), §A.4 (notably
  Wi-Fi-only-off ⇒ cellular fills and the paid-tier note), and the filled §Test strategy.
- No code, branch or `status.md` entry before this gate.

## Phase 0: Preconditions

### S0 — Re-verify anchors and cut the branch
- **Owner agent:** `noob-dev`
- **What:**
  1. `git status` clean on `dev`.
  2. Re-verify every §A.2 anchor by `grep -n` (line numbers may drift; the symbol must exist with the
     described shape). Any missing symbol → `HALTED`.
  3. Confirm `mobile/package.json` has no `expo-crypto`/AsyncStorage and does have `expo-sqlite`,
     `expo-file-system`, `expo-network`.
  4. Record the next free ADR number in `docs/adr/` (for S10).
  5. `git switch -c feat/media-cache dev`.
- **Verification:** the three commands green on the new branch; record pass/fail counts as baseline.
  On-device: the dev client builds and a non-HLS sermon streams (baseline).
- **Status entry:** `[MEDIA-CACHE — S0 anchors + branch]` with base SHA, anchor table (symbol →
  current line), ADR number, baseline counts. On failure: `HALTED: <check>`.

## Phase 1: Core modules and the hit/miss path

### S1 — Cache key, paths and constants
- **Owner agent:** `mobile-developer`
- **What:** New `mobile/lib/mediaCache/` with:
  - `key.ts` — `cacheKeyFor(mediaRefs, selectedVariant)`: match by `type`; return `null` if no match,
    if the variant URL is `.m3u8` (path, ignoring query) or not `http(s)`, or if the id is not a strict
    UUID (P3). Returns `{ mediaRefId, fileName }`.
  - `paths.ts` — `mediaCacheDir()` = `cacheDirectory + 'rpa-media-cache/'`, file and `.part` paths,
    web-guarded like `mobile/lib/downloads/paths.ts`.
  - `constants.ts` — D15 constants, the P1 progress window `[0.05, 0.90]`, P2 expiry margin.
  - `events.ts` — the P7 `__DEV__` event emitter.
- **Files / scope:** `mobile/lib/mediaCache/{key,paths,constants,events}.ts` + tests.
- **Verification:** the three commands. Jest covers: audio ref → key; `.m3u8` with and without query →
  `null`; `file://`/`data:` → `null`; non-UUID id → `null`; file name never contains `?`, `/`, `%` or
  any substring of the URL. No on-device check (no behaviour yet).
- **Status entry:** `[MEDIA-CACHE — S1 key/paths/constants]`.

### S2 — Manifest DB
- **Owner agent:** `mobile-developer`
- **What:** `mobile/lib/mediaCache/manifest.ts` on its own expo-sqlite file `rpa-media-cache.db`
  (D10). One table, keyed by `media_ref_id`, with `sermon_id`, `file_name`, `size_bytes`,
  `last_accessed_at`, `created_at`. **No URL column of any kind.** Operations: `get`, `insert`,
  `touch`, `deleteByKey`, `deleteBySermon`, `listByLru`, `totalBytes`, `close`. Follow the
  open/migrate pattern in `mobile/lib/downloads/db.ts` without importing or altering it.
- **Files / scope:** `mobile/lib/mediaCache/manifest.ts` + tests.
- **Verification:** the three commands. Jest asserts the schema has no column whose name contains
  `url`, `token` or `query`, and that `rpa-downloads` schema/DB name is never referenced.
- **Status entry:** `[MEDIA-CACHE — S2 manifest]`.

### [HUMAN_GATE G1] — At-rest posture: plaintext cache
- Crossed before S3, the first step whose code writes cached media to disk.
- Isaac reads D1/D2 as written back here and signs off explicitly in chat: cached audio is stored
  **plaintext** under `cacheDirectory/rpa-media-cache/`, OS-evictable, wiped on sign-out; encryption
  remains exclusive to Downloads; the M9 guarantee is not extended to the cache. Also confirms P4.
- If Isaac rejects plaintext, execution halts and the Conductor amends (this is a design change, not
  an executor fix).

### S3 — Fill engine (shared transfer + Wi-Fi gate)
- **Owner agent:** `mobile-developer`
- **What:**
  1. Export `realDownloadToFile` and `realCanStartDownload` from `downloadManager.ts` (or move them
     to a small sibling module the manager imports) **with zero behaviour change to Downloads**.
     If sharing requires changing their behaviour, halt.
  2. `mobile/lib/mediaCache/fill.ts`: `requestFill({ sermonId, key, url, expiresAt })`. Single-flight
     (D16: newer cancels older). Order: P2 expiry check → Wi-Fi gate (D4) → free-space floor and
     per-item skip (D15, using `FileSystem.getFreeDiskStorageAsync`) → transfer to `.part` → size
     check vs `Content-Length` (P4) → rename → `manifest.insert`. Any failure deletes the `.part`.
     Exposes `cancelFill(sermonId?)` and the P6 generation counter. Never logs or stores `url`.
- **Files / scope:** `mobile/lib/downloads/downloadManager.ts` (export only),
  `mobile/lib/mediaCache/fill.ts` + tests.
- **Verification:** the three commands; existing `mobile/lib/downloads/__tests__/downloadManager.test.ts`
  passes unmodified. Jest (injected transfer + network deps, same style as `downloadManager.test.ts`):
  Wi-Fi-only on + cellular → skip; Wi-Fi-only off + cellular → fills; size mismatch → no row, no
  `.part`; missing `Content-Length` → no row; second request cancels the first; expired URL → skip;
  captured logs and manifest rows contain no URL substring. No on-device check (not wired yet).
- **Status entry:** `[MEDIA-CACHE — S3 fill engine]`, stating explicitly that Downloads behaviour is
  unchanged and how the primitives were shared.

### S4 — Player integration: miss → fill on exit, hit → `/stream` then local file
- **Owner agent:** `mobile-developer`
- **What:** A hook (e.g. `mobile/lib/mediaCache/useCachedSource.ts`) used by
  `mobile/app/player/[id].tsx` on the streaming path only (`!isDownloaded`; `useLocalPlayback` and the
  Downloads path untouched):
  - After `useStream` succeeds and a variant is selected, compute the key (S1). `null` → stream as
    today. Otherwise look up the manifest; on a valid hit (P5) the player source is the local
    `file://` URI and the entry is touched and pinned as "playing"; on a miss the source is the stream
    URL.
  - `/stream` failure → existing error UI; the local file is never used (D11).
  - On qualifying exit (P1) with progress in the window, on a miss, call `requestFill`.
  - Player mount ordering stays "mount once all reads resolve"; the manifest lookup joins that set.
- **Files / scope:** `mobile/lib/mediaCache/useCachedSource.ts` + tests; `mobile/app/player/[id].tsx`
  (minimal wiring only).
- **Verification:** the three commands. Jest: `/stream` 403/404/network error with a valid hit → no
  local source; HLS variant → no lookup, no fill; exit at 4 %/91 % → no fill; exit at 50 % → fill
  requested once. **On-device:** (a) open a non-HLS sermon on Wi-Fi, listen past 5 %, leave → event
  log shows `miss` then `fill-start` → `fill-commit`; (b) reopen → log shows `/stream` call then `hit`,
  playback starts from the local file; (c) open an HLS (video) sermon, play and leave mid-way → no
  cache events, playback identical to baseline; (d) Wi-Fi-only on, Wi-Fi off → `fill-skip:network`.
- **Status entry:** `[MEDIA-CACHE — S4 hit/miss path]` with each on-device result (a)–(d).

## Phase 2: Bounds, Downloads-wins, sign-out

### S5 — Quota, LRU eviction and startup sweep
- **Owner agent:** `mobile-developer`
- **What:** `mobile/lib/mediaCache/quota.ts` (D15 formula, pure, injected free-space) and
  `evict.ts` (after every `fill-commit`: evict oldest `last_accessed_at` until under quota, skipping
  pinned playing/mid-write entries, D16). `sweep.ts`: single-flight, runs on first cache access per app
  launch (D14), not inside Downloads' `startupSweep()`.
- **Files / scope:** `mobile/lib/mediaCache/{quota,evict,sweep}.ts` + tests; call sites in
  `fill.ts` / `useCachedSource.ts`.
- **Verification:** the three commands. Jest: quota formula at the ceiling, at the 10 % branch and
  below the 1.5 GB floor; single item > 50 % skipped; LRU order; pinned entry survives; sweep removes
  missing-file rows, wrong-size rows, orphan `.part`, row-less files; sweep runs once under concurrent
  first access. **On-device:** with the hard ceiling temporarily lowered in a local, uncommitted edit
  (e.g. just above one item's size), fill two sermons → log shows `evict` of the older; the evicted
  file is gone and its next open is a `miss`. Revert the edit before committing; `git diff` of
  `constants.ts` is clean in the status entry.
- **Status entry:** `[MEDIA-CACHE — S5 quota/eviction/sweep]` with the on-device eviction result.

### S6 — Downloads wins
- **Owner agent:** `mobile-developer`
- **What:** Immediately after each `deps.db.markReady(...)` (`downloadManager.ts:225`, `:270`), call
  the cache's `deleteBySermon(sermonId)` and `cancelFill(sermonId)` through an injected dep (so
  `downloadManager.test.ts` stays isolated). A cache failure must never fail the download.
- **Files / scope:** `mobile/lib/downloads/downloadManager.ts`, `mobile/lib/mediaCache/` + tests.
- **Verification:** the three commands. Jest: `ready` → cache entry deleted and fill cancelled; cache
  delete throws → download still `ready`. **On-device:** cache a sermon (S4 a), then Download it →
  log shows the cache entry removed; the sermon now plays via the Downloads path (`useLocalPlayback`),
  no cache events.
- **Status entry:** `[MEDIA-CACHE — S6 Downloads wins]`.

### [HUMAN_GATE G2] — Auth-path touch: `clearMediaCache()` in `clearSession()`
- Crossed before S7. This is the only edit to `mobile/lib/auth/session.ts` in the plan.
- **Choice: `clearSession()`, not `signOut()`-only.** `clearSession()` (`session.ts:53`) is reached by
  voluntary `signOut()` (:142) **and** both forced sign-out paths on refresh failure (:162, :180).
  Putting the wipe there means an expired or revoked session also wipes the previous user's cache
  before anyone else signs in on the device. `signOut()`-only would leave the cache in place on
  forced sign-out. Cost: a refresh failure wipes the cache — acceptable because the cache is
  disposable by design.
- Isaac also approves P6 (cancel in-flight fill, generation counter, best-effort, never throws into
  `clearSession()`, Downloads untouched).

### S7 — Sign-out wipe
- **Owner agent:** `mobile-developer`
- **What:** `clearMediaCache()` in `mobile/lib/mediaCache/` implementing P6; one call added inside
  `clearSession()`. No other change to `session.ts`.
- **Files / scope:** `mobile/lib/auth/session.ts` (one call), `mobile/lib/mediaCache/` + tests.
- **Verification:** the three commands. Jest: all three `clearSession()` paths invoke the wipe; wipe
  throwing does not stop tokens being cleared; an in-flight fill that resolves after the wipe commits
  no row; Downloads DB and `rpa-downloads/` untouched. **On-device:** cache a sermon, keep a Download
  of another, sign out → log shows `wipe`; sign back in → the cached sermon is a `miss`; the Download
  still plays.
- **Status entry:** `[MEDIA-CACHE — S7 sign-out wipe]`.

## Phase 3: Close-out

### S8 — Code review
- **Owner agent:** `reviewer-gilfoyle`
- **What:** Review the full branch diff against §A: Downloads behaviour unchanged by the S3 export,
  single-flight and pinning correctness, race between fill-commit / evict / wipe, no "while I'm here"
  edits, no new dependency.
- **Verification:** findings in `status.md`; blocking findings fixed by `mobile-developer` and the three
  commands re-run green.
- **Status entry:** `[MEDIA-CACHE — S8 gilfoyle review]`.

### S9 — Security review
- **Owner agent:** `security-reviewer`
- **What:** Sign-out wipe completeness (all three paths, generation counter, residue on wipe failure);
  path hygiene (no raw server strings, no URL/query/token in manifest, file names or logs; `__DEV__`
  gating of P7); D11 re-validation cannot be bypassed; plaintext boundary D2 holds (cache never shares
  dirs, keys or DB with Downloads).
- **Verification:** sign-off or findings in `status.md`; blocking findings fixed and re-verified.
- **Status entry:** `[MEDIA-CACHE — S9 security review]`.

### S10 — ADR and index (ADR confirmed by Isaac)
- **Owner agent:** `scribe`
- **What:** ADR `docs/adr/<S0 number>-mobile-media-cache.md`: plaintext disposable cache vs encrypted
  Downloads boundary (D1/D2), `/stream` re-validation on every hit, HLS limitation, known limits (§A.4).
  Update this plan's row in `plans/README.md` to its final outcome after G3.
- **Verification:** ADR exists, matches shipped behaviour, follows the existing ADR format.
- **Status entry:** `[MEDIA-CACHE — S10 ADR]`.

### [HUMAN_GATE G3] — Merge into `dev`
- **Preconditions:** S8 and S9 sign-offs in `status.md`; every §Test strategy case green; the three
  commands green; every DoD box checked with its evidence in `status.md`.
- Isaac reviews the branch diff summary and the `status.md` trail. The merge of `feat/media-cache`
  into `dev` is his: one controlled merge, simplified git flow, one feature branch, no pull request,
  conventional commits on the branch (`feat(mobile/media-cache): …`).
- **Branch model:** `dev` is the integration branch and the only branch pushed to origin. The trunk is
  `prod` (renamed from `main`). Nothing goes to `uat` or `prod` under this plan.
- No app-store / TestFlight build is authorized by this gate.

---

## Rollback

| Failure point | Revert |
|---|---|
| Any step before G3 | `git revert` or reset on `feat/media-cache`. Nothing has merged. |
| S3 export changes Downloads behaviour | Halt; revert the export; Conductor amends (copy vs share). |
| G1 rejected (plaintext) | Halt before any disk-writing code exists; Conductor amends. |
| G2 rejected | S7 not executed; plan cannot meet DoD; Conductor amends (e.g. `signOut()`-only). |
| After merge | `git revert` the merge commit. Residue on installed devices: `rpa-media-cache/` under `cacheDirectory` (OS-evictable) and an inert `rpa-media-cache.db`. Accepted; removing it needs a cleanup change, which would be its own plan. |

## Risks

| # | Risk | Mitigation |
|---|---|---|
| K1 | Fill-commit, evict and wipe race and resurrect or orphan files. | Single-flight fill, generation counter (P6), sweep (D14); S8 reviews explicitly. |
| K2 | Sharing `realDownloadToFile` couples cache fills to Downloads' background session, so a cache fill and a Download compete. | Single-flight on the cache side; Downloads-wins (D18) cancels the fill for the same sermon. S3 halts if sharing requires behavioural change. |
| K3 | Manifest lookup adds start latency to every streamed play. | One indexed SQLite read; joins the existing "mount when all reads resolve" set. |
| K4 | `Content-Length` absent from the R2 signed URL response makes every fill fail closed. | P4 fails closed (no row); S4 on-device (a) proves it is present; if not, halt and amend. |
| K5 | Branch carries an unbounded cache between S4 and S5. | Branch-only (P8); nothing merges before G3. |
