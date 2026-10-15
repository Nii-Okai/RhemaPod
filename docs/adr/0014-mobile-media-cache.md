# ADR 0014 — Mobile media cache: plaintext disposable cache vs. encrypted Downloads boundary

- **Status:** Accepted. `plans/plan-media-cache.md` §T.4's on-device checklist (V1-V16, recorded
  in `status.md` 2026-10-15) is complete: V1 settled risk K4 (R2's presigned `/stream` responses do
  send a real `Content-Length`), and every item only a physical device can show — V14/V15
  background-kill behaviour, V16 the real SQLite engine accepting the manifest DDL, V5/V6 eviction
  under real disk pressure — has a recorded outcome, either confirmed directly on Isaac's iPhone or
  (V10, V12, V15's kill-timing specifically) accepted as Jest-verified where this dev stack's tiny
  seed media made a clean manual repro impractical, Isaac's explicit call in each case. Two real,
  pre-existing bugs surfaced as a side effect (a `sermons.status` ORM enum-casing crash on raw
  lowercase writes, and a staff-preview-bypasses-publish-status gap) — both unrelated to this
  plan's own scope, flagged separately in `status.md` for backend follow-up, not fixed here.
  `[HUMAN_GATE G3]` (merge into `dev`) is a separate decision still awaiting Isaac's explicit
  go-ahead in chat — this ADR's Accepted status does not itself cross that gate.
- **Date:** 2026-10-14
- **Scope:** `mobile/` only. New: `mobile/lib/mediaCache/` (`key.ts`, `paths.ts`, `constants.ts`,
  `events.ts`, `manifest.ts`, `fill.ts`, `quota.ts`, `evict.ts`, `sweep.ts`, `nowPlaying.ts`,
  `useCachedSource.ts`, `dropSermon.ts`, `clearMediaCache.ts` + tests). Touched: one call +
  gate composition moved into `mobile/lib/downloads/network.ts`; `mobile/lib/downloads/downloadManager.ts`
  (an injected `onDownloadReady` dep, called after each `markReady`); `mobile/lib/auth/session.ts`
  (one call in `clearSession()`, two lazy `require()`s); `mobile/lib/query/hooks/useStream.ts`;
  `mobile/lib/query/QueryProvider.tsx`; `mobile/app/player/[id].tsx` (hook wiring only). No change
  under `app/`, `alembic/`, `openapi.json`, `mobile/lib/api/schema.d.ts`, or the Downloads SQLite
  schema. No new dependency.
- **Deciders:** Isaac (+ architect, security-reviewer, reviewer-gilfoyle, conductor)
- **Relates to:** `plans/plan-media-cache.md` §A.1 (D1-D19), §A.3 (P1-P8), §A.4;
  `[HUMAN_GATE G0]`-`[HUMAN_GATE G3]`; `status.md` `MEDIA-CACHE —` entries S0 through the S8/S9
  confirmation-pass round; `mobile/lib/downloads/` (RPA1 encryption, `installKey.ts`,
  `rpa-crypto`) as the companion durable path this ADR is drawn against.

> A streamed, non-HLS sermon the user partly listens to is silently cached to disk on Wi-Fi as a
> **plaintext**, disposable copy; the next open always re-validates through `/stream` before the
> local file is used, and the whole cache is wiped on sign-out. It is not Downloads: Downloads
> stays the only durable, encrypted, offline-guaranteed path, and the cache never touches it.

---

## Context

The app already has one durable on-device media artifact: Downloads. A download is explicit
(user-initiated), long-lived, encrypted with the RPA1 format under an install-bound key
(`mobile/lib/downloads/installKey.ts`, `rpa-crypto`), stored under `rpa-download-tmp/` /
Downloads' own directory, and is meant to work indefinitely with zero further network or
entitlement check — that is the whole point of taking a sermon offline. This is ADR-grade
behaviour already in force; it has no prior ADR of its own, but it is the fixed point this plan is
drawn against.

This plan adds a second, different disk-resident artifact: a transparent cache that silently
speeds up re-opening a sermon the user streamed but didn't explicitly download. It is scoped as
disposable, OS-evictable, and re-validated on every use — the opposite of Downloads' guarantees on
every axis. Putting two media-on-disk subsystems next to each other, under the same
`FileSystem.cacheDirectory`-adjacent area of the app, created real ambiguity about which
guarantees apply to which, and that ambiguity was not hypothetical: during implementation, three
independent reviewers (security-reviewer, reviewer-gilfoyle, and the architect at planning time)
each separately treated the cache's plaintext storage as a posture gap against Downloads' own
encryption, before Isaac's explicit ruling at `[HUMAN_GATE G1]` settled it (`status.md`, `G1
crossed`/`G1 correction` entries). A decision that confuses three independent reviewers in
succession is exactly the kind of thing that belongs in an ADR instead of being re-derived from
code every time someone touches either module.

## Decision

### 1. Plaintext cache, encrypted Downloads — the boundary (D1/D2, `[HUMAN_GATE G1]`)

- The cache stores media **unencrypted** under `FileSystem.cacheDirectory + 'rpa-media-cache/'`
  (`mobile/lib/mediaCache/paths.ts`, D17). It never uses `rpa-crypto`, `installKey`, the RPA1
  format, or `rpa-playback-tmp/`. Downloads never reads from the cache; the cache never reads
  Downloads' DB or directory. There is no shared code path between the two beyond the Wi-Fi gate
  (see §4 below) and the D18 "Downloads wins" hook.
- **Why plaintext is the right call, not a shortcut:** every cache hit re-validates through
  `/stream` before the local file is used (D11, §2 below) — a cache hit never grants the user
  anything they couldn't already get by streaming live at that exact moment. A cached file is
  therefore a disposable copy of bytes the device already had cleartext access to, mid-playback,
  seconds earlier. There is no new confidentiality obligation created by letting those same bytes
  sit on disk a while longer. Downloads is different in kind: it is a deliberate, durable,
  user-initiated "take this fully offline, forever, no further check" action, and that is exactly
  what the RPA1/install-key machinery and the "M9" guarantee ("not playable by an external tool")
  exist to protect.
- **The M9 guarantee is explicitly not extended to, or weakened by, the cache's existence.** It
  remains a Downloads-only property. Signed off by Isaac directly at G1 (`status.md`, G1
  crossed/correction entries, 2026-10-13): plaintext storage, OS-evictable, wiped on sign-out,
  encryption remains exclusive to Downloads.
- Concretely, the two subsystems are kept structurally separate, not just by convention: own
  subfolder (`rpa-media-cache/` vs. Downloads' own directory, D17), own manifest DB
  (`rpa-media-cache.db`, D10, with its own schema — no column name containing `url`, `token` or
  `query`, asserted in `manifest.test.ts`) separate from Downloads' `db.ts` and schema, own key
  scheme (`MediaRef.id`, a server UUID — D9/P3 — not a content hash, and not shared with Downloads'
  own file-naming), and no raw server strings, query strings or presigned-URL substrings ever
  written to the manifest, a file name, or a log line (D12; asserted across every success and
  failure path by a shared `expectNoSecrets` test helper).

### 2. `/stream` re-validation on every hit (D11), hardened after a confirmed bypass

The original design was simple: every cache hit calls `/stream` first (paywall, takedown,
unpublish), and only a 200 response lets the player source switch to the local file — a hit never
grants offline playback. That rule alone, though, turned out to be insufficient once react-query's
own caching and disk persistence were in the picture. Security review finding B1 (confirmed
BLOCKER, `status.md` S8/S9 entries) found a *stale* `/stream` result could read as "fresh enough"
for a hit through three concrete paths:

1. Reopening the player within the default 5-minute `staleTime` window never even triggered a
   background refetch — the player could act on data that was already minutes old.
2. A `/stream` response restored from the 24-hour on-disk query persister
   (`QueryProvider.tsx`'s `maxAge`) could already be hours past its own ~6-hour signed-URL
   expiry on a cold app relaunch, yet still read as "data present."
3. Offline, react-query's `networkMode: 'online'` pauses the refetch without ever raising
   `isError`, so a hit could serve the local plaintext file with zero live entitlement check at
   all.

Isaac's explicit decision: fix this **strictly** — no offline cache hits, under any of the three
paths — restoring D11's original intent rather than treating the gap as a new policy needing its
own decision. The fix touches three files:

- `mobile/lib/query/hooks/useStream.ts` — `staleTime: 0` and `refetchOnMount: 'always'` on the
  `/stream` query itself, so every mount genuinely re-fetches regardless of the client's default
  staleness window (closes path 1).
- `mobile/lib/query/QueryProvider.tsx` — `shouldPersistQuery` excludes the `stream` query root
  from the 24-hour disk persister entirely (closes path 2; as a side effect it also keeps
  presigned URLs, however short-lived, out of the on-disk query cache).
- `mobile/app/player/[id].tsx` — computes `isStreamFreshThisMount =
  streamQuery.isFetchedAfterMount && !streamQuery.isError` and ANDs it into
  `useCachedSource`'s own `enabled` flag, so a hit can only ever happen once *this mount's own*
  fetch has genuinely succeeded (closes path 3, and reinforces 1).

This is scoped deliberately to the cache's own `enabled` flag, not the screen's overall loading
gate: an uncached or already-fresh sermon still opens at its usual speed, and a reopened cached
sermon still starts streaming immediately via the plain URL while freshness confirms in the
background — nothing user-facing got slower. The bypass was specifically about substituting the
local file, not about ordinary streaming, which the storage layer's own signed-URL validity
already re-checks regardless of the app's query freshness.

### 3. The HLS/Cloudflare Stream limitation — permanent for Phase 1, not a TODO

`cacheKeyFor` (`mobile/lib/mediaCache/key.ts`) returns `null` for any selected variant URL ending
in `.m3u8` (case-insensitive, query stripped), for anything that isn't strict `http(s)`, and for
any `MediaRef.id` that isn't a strict UUID. Cloudflare-Stream-ingested video resolves to an HLS
manifest URL (`_resolve_variant_url` in `app/services/media_service.py`) — those sermons produce no
manifest row, no cached file, and no player special-casing; they stream exactly as they did before
this plan existed. This is a deliberate Phase 1 scope boundary (see the plan's Scope "Out"
section), not an oversight: segment-based HLS caching (many small files, manifest rewriting) is a
materially different engineering problem this plan never attempted.

### 4. Known limits carried from §A.4 (accepted for Phase 1, not TODOs)

- **Paid-tier paywall exists.** `_authorize_stream_access` 403s `ContentTier.PAID` content without
  a subscription — doesn't change this design, since D11 re-validates every hit; a lapsed
  subscriber's hit simply falls through to the existing error path.
- **Background-kill fill loss.** A fill's completion (size verify, `.part` rename, manifest
  insert) only runs when JS resumes. If iOS kills the suspended app mid-fill, the fill is lost; the
  orphan `.part` is cleaned by the startup sweep and the next qualifying exit retries.
- **Wi-Fi is checked only at fill start**, not continuously — a mid-transfer drop to cellular may
  continue on cellular. This is the same exposure Downloads already accepts, not a new one.
- **`wifiOnly` off means cache fills happen on cellular too** — a literal consequence of reusing
  Downloads' existing toggle (D4) rather than adding a separate cache-specific setting. Surfaced
  explicitly and approved at `[HUMAN_GATE G0]`.
- **HLS sermons are never cached** (restated from §3 above, since it is a limit as much as a design
  choice).
- **No new entitlement or background mode was needed** for the background transfer mechanism
  (D7); if the on-device pass finds otherwise, that is a halt and a plan amendment, not a silent
  add.

### 5. Module boundaries that came out of two review rounds

Two review rounds reshaped exactly where the cache's code sits relative to Downloads and auth —
which is squarely what this ADR is about:

- **The Wi-Fi gate now lives in `mobile/lib/downloads/network.ts`, not `downloadManager.ts`.**
  `realCanStartDownload` was originally exported from `downloadManager.ts` so `fill.ts` could reuse
  it (S3). That created a real circular import once S6 wired Downloads to call back into the cache
  (`downloadManager.ts` → `dropSermon.ts` → `fill.ts` → `downloadManager.ts`), and a second, longer
  cycle once S7 wired `session.ts` into the cache too
  (`session.ts` → `fill.ts` → `downloadManager.ts` → `api/typedClient.ts` → `api/client.ts` →
  `session.ts`). Both reviewers flagged this explicitly. The fix moved `realCanStartDownload` into
  `mobile/lib/downloads/network.ts` (composed there from `loadDownloadPreferences()` and
  `isOnWifi()`/`canStartDownload`), so `mobile/lib/mediaCache/fill.ts` now depends on
  `lib/downloads/network.ts` only — never on `downloadManager.ts`. `network.ts` is the single
  owner of the Wi-Fi gate for both Downloads and the cache.
- **`mobile/lib/auth/session.ts` reaches the cache through a lazy `require()`, never a static
  import.** `clearSession()` needs to call `clearMediaCache()`, and `applyTokenPair()` needs to
  call `allowFillsAfterSignIn()` — both live in `mediaCache`. A static top-level import here would
  have reintroduced the same class of cycle through the API client. A dynamic `import()` was tried
  first as the ESM-native way to do this lazily, and rejected after confirming empirically that
  this project's Jest config has no `--experimental-vm-modules`, so `import()` throws under test;
  `require()` is plain CommonJS, still lazy at call time, and already works in this codebase.
- **Net effect, which is the actual shape of "where the cache ends and Downloads/session begin":**
  `downloadManager.ts` depends on the cache (`dropSermonFromCache`, for D18 "Downloads wins"),
  never the reverse. The cache depends on `lib/downloads/network.ts` (a small, side-effect-free,
  shared gate), never on `downloadManager.ts` itself. `session.ts` does not statically know the
  cache module exists at all — it only reaches it lazily, at the two call sites that need it. The
  import graph between these three areas is now acyclic by construction, not "works despite a
  cycle."

## Consequences

- **Positive:** one place to answer "why is this plaintext and that encrypted" for every future
  reviewer or junior dev touching either `lib/downloads/` or `lib/mediaCache/`, instead of
  re-litigating it per PR (it already cost three independent review passes once). The B1
  re-validation hardening closes a real entitlement bypass before merge, not after. The module
  graph across Downloads/cache/session is now acyclic, which is a safer property on its own merits
  than "circular imports that happen to resolve at runtime."
- **Negative:** two different disk-resident media subsystems now exist in the mobile app, each
  with its own lifecycle, and a future contributor has to know which one they're in. The OS can
  evict `rpa-media-cache/` at any time outside the app's control (mitigated by the startup sweep
  reconciling manifest rows against what's actually on disk, not eliminated). If this feature is
  ever reverted post-merge, `rpa-media-cache/` and an inert `rpa-media-cache.db` remain on
  already-installed devices (accepted per the plan's own Rollback table; a cleanup would be its own
  plan).
- **Neutral:** no new dependency was added (`expo-sqlite`, `expo-file-system`, `expo-network` were
  already installed, D19). No backend, migration, or public-API change (D19).

## Alternatives considered

- **Encrypt the cache the same way as Downloads:** rejected. The cache's entire value proposition
  is being disposable and silent; adding install-bound-key machinery to content the device is
  already streaming in the clear adds real complexity for no attacker-facing benefit, since D11
  means nothing is reachable at rest that wasn't already reachable live, a moment earlier, over the
  network.
- **Literal reuse of Downloads' `realDownloadToFile` for cache fills:** rejected (S3 deviation,
  accepted at `[HUMAN_GATE G2]`). That function's contract (`void` return, no response headers
  surfaced, no cancellation handle) cannot give the fill engine the `Content-Length` verification
  (D13/P4) or the single-flight cancellation (D16) it needs without changing Downloads' own
  function signature — which the plan's own halt condition forbids ("if sharing requires changing
  their behaviour, halt"). `fill.ts` got its own small, parallel transfer implementation using the
  same `createDownloadResumable` pattern instead; Downloads' own behaviour is untouched either way.
- **Treating the B1 fix as a policy change needing its own ADR branch:** rejected by Isaac.
  Fixing it strictly (no offline cache hits under any of the three bypass paths) restores D11's
  original, already-decided intent; it is a bug fix against an existing decision, not a new one.

