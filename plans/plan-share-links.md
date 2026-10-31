# Plan: RhemaPod https share links (Universal Links / App Links)

Replace the untappable `rhemapod://` share link with `https://open.rhemapod.com/<type>/<uuid>`. The link
opens the app when it is installed (iOS Universal Links, Android App Links). When it isn't, a
static fallback page offers "Open in RhemaPod" and a store badge.

- **Phase 1 (S1–S10): sermons + series.** A new free Render Static Site on `open.rhemapod.com`, one DNS record,
  association files, mobile link handling, new TestFlight + APK builds.
- **Phase 2 (S11–S15): playlists.** Existing playlists are backfilled to private, signed-in
  non-owners can read public playlists, and owners get a share flow with a make-public prompt.

Decisions are Isaac's from 2026-10-31, recorded in `status.md` under "Tester feedback 2026-10-31"
and "Share links — design decisions" (skeptic + architect converged; Isaac answered by
AskUserQuestion). `[HUMAN_GATE SL0]` passed 2026-10-31 with all planner recommendations accepted and
the share host moved from the apex to `open.rhemapod.com` (§SL0). `rhemapod.com` itself is not
touched by this plan. Execution is logged in the append-only root `status.md` with the prefix
`SHARE-LINKS`, one `## SHARE-LINKS — <step> <agent: …> <date>` heading per step.

Executors halt **only** at gates. If something diverges from this plan, they halt and the
Conductor decides whether to amend. Phase 1 has **no schema change and no backend change**. If
one shows up, it's a new gate: halt.

---

## Goal

A RhemaPod share link is a tappable `https://open.rhemapod.com/{sermon,series,playlist}/<uuid>`. Tapping
it opens the right screen in the installed app on iOS and Android, signed in or not. When the app
isn't installed, it shows a static, data-free page that links to the store. Playlists can be shared
by their owner once made public, and recipients see a read-only view with the owner shown as
"First L.".

## Definition of Done

- [ ] `https://open.rhemapod.com` is served by a new free Render Static Site (`rhemapod-open`) from
      `open_site/`. Isaac has added the `open` CNAME. TLS is valid. No other DNS record changed;
      `rhemapod.com` is untouched.
- [ ] `/.well-known/apple-app-site-association` returns 200, `Content-Type: application/json`,
      no redirect. It claims only `/sermon/*`, `/series/*`, `/playlist/*` and excludes
      `/playlist/create`, for `FAND2W5VMM.com.niitech.rhemapod`. Apple's CDN serves the same body.
- [ ] `/.well-known/assetlinks.json` lists `com.niitech.rhemapod` with the EAS keystore SHA-256.
      Google's Digital Asset Links API confirms the `handle_all_urls` statement.
- [ ] The fallback page (§D.2) is fully static: no fetch, no ID in the DOM, `noindex`, no
      analytics, no auto-redirect.
- [ ] The legal paths 301 to `admin.rhemapod.com`. `/` is the one-screen brand page (§D.3).
- [ ] Mobile: `associatedDomains` and the Android `intentFilters` (autoVerify) are in `app.json`.
      `app/+native-intent.tsx` applies the allow-list. Signed-out stash-and-replay works. A cold
      start's back target is home. Sermon, series and playlist each have a real "no longer
      available" state. Share messages carry `https://open.rhemapod.com/...`.
- [ ] Phase 1 on-device checklist (§D.6) passes on a TestFlight build and an android-internal APK
      (`[HUMAN_GATE SL3]`).
- [ ] Phase 2: the migration backfills every playlist to `is_public=false` and sets the
      server_default to false. `PlaylistCreate.is_public` defaults to false.
- [ ] Phase 2: a signed-in non-owner can `GET /playlists/{id}` for a public playlist. Private,
      missing and block-hidden playlists all return the same 404. Items are filtered by the
      existing visibility rules. The owner is shown as `public_display_name` ("First L.").
- [ ] Phase 2: the owner's Share action runs the make-public Alert (§P.3). The recipient view is
      read-only. The phase 2 on-device checklist passes (`[HUMAN_GATE SL7]`).
- [ ] ADR 0021 is Accepted (`[HUMAN_GATE SL2]`, plus its Phase 2 addendum if the contract changed
      at `[HUMAN_GATE SL5]`).
- [ ] Green on each phase's branch head:
      - backend `uv run pytest -q --tb=short` (with the env-blanking prefix)
      - portal `npm run verify` (Phase 2 only, after the types regen)
      - mobile `npx tsc --noEmit` and `npx jest`
      - `node --test open_site/tests/`
      - `pre-commit run --all-files`
- [ ] The launch checklist item (L1, Play app-signing SHA-256) is recorded as owed under M11.

## Constraints / Assumptions

- **Trunk is `dev`** (there is no `main`). Phase 1 branch: `feat/share-links` off `dev`.
  Phase 2 branch: `feat/share-links-playlists` off `dev`, cut **after** `[HUMAN_GATE SL3]`. No
  PRs. Conventional commits. Push after each commit.
- **Merging into `dev` deploys to Render dev** (api, admin, and the new `rhemapod-open` static site).
  `scripts/render-start.sh` runs `alembic upgrade head` on API start, so a Phase 2 merge
  **applies the migration**. SL1, SL2 and SL6 are deploy gates.
- **Mobile is CNG.** `ios/` and `android/` are gitignored and `app.json` is the source of truth.
  There is no `expo-updates`, so every JS change ships only in a new binary. EAS profiles:
  `testflight` (iOS, image `macos-tahoe-26.5-xcode-26.6`, pinned) and `android-internal` (APK, EAS
  keystore). Neither profile changes.
- **The share host is permanent.** URLs `https://open.rhemapod.com/{sermon,series,playlist}/<uuid>` match the
  app routes (`app/sermon/[id].tsx`, `app/series/[id].tsx`, `app/playlist/[id].tsx`) and are a
  forever contract (ADR 0021). The `rhemapod://` scheme stays forever.
- **The `rhemapod-open` site tracks `dev`**, because there is no prod stack yet. When a prod stack exists, it
  moves to the prod branch (see Risks).
- **No new dependencies.**
  - The static site is hand-written HTML/CSS plus one inline script, with no build step.
  - Its tests use Node's built-in `node --test`.
  - Mobile keeps `react-native-share` and `expo-file-system`, and needs no new linking library
    (Expo Router's `+native-intent` is built in).
  - If any step thinks it needs a dependency, halt.
- **Tests:** real Postgres via Testcontainers. No mocked session.
  - Backend command:
    `OBJECT_STORE_ACCESS_KEY_ID= OBJECT_STORE_SECRET_ACCESS_KEY= ARCHIVE_STORE_ACCESS_KEY_ID= ARCHIVE_STORE_SECRET_ACCESS_KEY= uv run pytest -q --tb=short`
  - Mobile: `npx tsc --noEmit && npx jest` in `mobile/`.
  - Portal: `PATH=/usr/local/opt/node@24/bin:$PATH npm run verify` in `admin_portal/`.
- **Recipients must be signed in** to see content, including a public playlist. The API gains no
  anonymous read. The fallback page never calls the API.
- **Not in scope:**
  - per-content OG previews (that would mean a server-rendered page reading data, which this
    design rejects);
  - web playback of shared content;
  - share analytics;
  - the Play app-signing fingerprint (L1, launch time);
  - `rhemapod.com` (apex) and `www`: not touched;
  - removing `react-native-share`;
  - discoverability or browsing of public playlists (a link is the only way in).

---

## Phase 1 — design (binding)

### D.1 `open_site/` (new, repo root)
```
open_site/
  index.html                          # "/" one-screen brand page (§D.3)
  open.html                           # fallback for content paths (§D.2)
  open.js                             # tiny client script (inline-able; kept separate for node --test)
  .well-known/apple-app-site-association   # no extension
  .well-known/assetlinks.json
  robots.txt                          # Allow all (crawlers must reach the noindex)
  assets/                             # logo, App Store / Google Play badges (official artwork)
  tests/open.test.mjs                 # node --test, no deps
```

**AASA** uses the components format only, because the app's minimum is iOS 15.1. The
`/playlist/create` exclude comes first:
```json
{"applinks":{"details":[{"appIDs":["FAND2W5VMM.com.niitech.rhemapod"],
 "components":[{"/":"/playlist/create","exclude":true},
               {"/":"/sermon/*"},{"/":"/series/*"},{"/":"/playlist/*"}]}]}}
```
There is no `webcredentials` or `appclips` section.

**assetlinks.json** has one statement: `delegate_permission/common.handle_all_urls`, for
`android_app` `com.niitech.rhemapod`, with `sha256_cert_fingerprints` holding the EAS keystore
SHA-256 (obtained in S2). The Play app-signing SHA-256 is added at L1.

### D.2 Fallback page (`open.html`) — content paths
- **Static.**
  - No network calls except its own CSS and images.
  - No content ID in the HTML.
  - `<meta name="robots" content="noindex,nofollow">`, plus an `X-Robots-Tag: noindex` header.
  - No analytics, no cookies, no third-party origins.
- **Generic brand OG/Twitter tags** (title "RhemaPod", one-line description, brand image). The
  same tags appear on every content path.
- **Smart App Banner:** `<meta name="apple-itunes-app" content="app-id=6828878983">`. There is no
  `app-argument`, because the page is static.
- **"Open in RhemaPod" button.** `open.js` reads `location.pathname` and requires it to match
  `^/(sermon|series|playlist)/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/?$`
  (case-insensitive). On a match it sets the button's `href` to `rhemapod://<type>/<uuid>`.
  Otherwise it hides the button. It never writes the ID into visible text.
- **Store badge, by user agent:**
  - iOS → App Store `https://apps.apple.com/app/id6828878983`;
  - Android → Play `https://play.google.com/store/apps/details?id=com.niitech.rhemapod`;
  - desktop or unknown → both badges plus "Open this link on your phone".
  - Without JS, both badges show.
- **No auto-redirect** of any kind: no meta refresh, no `location` assignment.

### D.3 Other routes (Render static `routes` / `headers` in `render.yaml`)
- **Rewrites** (not redirects) to `/open.html`: `/sermon/*`, `/series/*`, `/playlist/*`.
- **301s** to `https://admin.rhemapod.com/<same path>`: `/privacy`, `/terms`, `/support`,
  `/delete-account`, `/guidelines`.
- **Headers:**
  - `Content-Type: application/json` on both `.well-known` files;
  - `X-Robots-Tag: noindex` on `/sermon/*`, `/series/*`, `/playlist/*`;
  - `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, and a strict CSP
    (`default-src 'self'; img-src 'self'; script-src 'self'; style-src 'self'`) site-wide.
- **`/`** is a one-screen brand page (SL0 answer 1): logo, one line, both store badges, and links
  to Privacy/Terms/Support on `admin.rhemapod.com`. Static, no script, same headers and CSP as the rest of the site.

### D.4 Mobile
- **`app.json`:**
  - `ios.associatedDomains: ["applinks:open.rhemapod.com"]`. The `applinks:open.rhemapod.com?mode=developer`
    variant is an option for a future dev client only; it is **not** added now, because
    TestFlight and APK builds don't use it.
  - `android.intentFilters`: one filter, `autoVerify: true`, action `VIEW`, categories
    `BROWSABLE` + `DEFAULT`, scheme `https`, host `open.rhemapod.com`, `pathPrefix` `/sermon/`,
    `/series/`, `/playlist/`.
  - `scheme: "rhemapod"` is unchanged.
- **`app/+native-intent.tsx`** (`redirectSystemPath`):
  - It normalises the incoming value, which may be a full `https://open.rhemapod.com/...` URL or a
    `rhemapod://` path.
  - It allows `/(sermon|series|playlist)/<uuid>` only. `/playlist/create`, unknown paths, query
    junk and foreign hosts go to home (`/`).
  - **Before narrowing**, S6 inventories every existing inbound `rhemapod://` use (OAuth
    redirects, notification taps, anything going through `Linking`). Any legitimate path it finds
    is preserved explicitly and listed in `status.md`. If preserving one needs a design call,
    halt.
- **Signed-out stash-and-replay:**
  - A content deep link arriving while signed out is stashed in memory (module scope, one slot,
    last one wins, 15-minute TTL). The user is sent to sign-in.
  - After a successful sign-in (password, Google or Apple), the stash is replayed once and then
    cleared.
  - A sign-out clears it. Nothing is persisted to disk.
- **Cold-start back target = home.** When a link cold-starts the app, the stack is home → target,
  so Back lands on home and not on an exit.
- **"No longer available" states:** a 404, an unpublished item or an invisible item shows one
  calm empty state per screen ("This sermon / series / playlist is no longer available") with a
  Go home button. It is not an error toast or a spinner. Phase 1 covers the playlist screen too,
  because AASA claims `/playlist/*` from day one and a non-owner gets 404 until Phase 2.
- **`lib/share/shareContent.ts`:**
  - The base is `EXPO_PUBLIC_SHARE_BASE_URL`, defaulting to `https://open.rhemapod.com` and read the
    same way as `lib/api/config.ts`. The message is `title`, then the truncated description, then
    `<base>/<deepLinkPath>`.
  - **Thumbnail (SL0 answer 2):** the image attachment is dropped, so messengers render the link
    card. This deliberately reverses Isaac's 2026-10-09 "include image thumbnail" request; he
    accepted that at SL0. The `thumbnailUrl` field and the download path are removed from callers,
    but `react-native-share` stays.
  - **No `?ref=share`** (SL0 answer 3): nothing consumes it.
  - The callers `app/sermon/[id].tsx` (~L113) and `app/series/_detail/useSeriesScreen.ts` (~L71)
    are touched only as far as the signature needs.

### D.5 DNS (Isaac, at his provider — `[HUMAN_GATE SL1]`)
- Add **one record**: `CNAME open → <rhemapod-open>.onrender.com` (the exact target is shown in
  the Render dashboard for the custom domain).
- If the provider is Cloudflare, the record stays **DNS only (grey cloud)**. A proxied record
  breaks Render's certificate issuance and can rewrite the AASA response.
- Don't modify any other record.

### D.6 Phase 1 on-device checklist (qa-strategist finalises in S9)
- **iOS (TestFlight)**, from each of WhatsApp, iMessage, Notes:
  - the link opens the app on the right screen, warm and cold;
  - Back from a cold start goes home.
- **Instagram in-app browser** (no UL by design) → fallback page → "Open in RhemaPod" opens the
  app.
- **Link pasted into the Safari address bar** → fallback page (expected: Safari doesn't trigger
  UL) → the button opens the app.
- **Signed out:** tap the link → sign-in → after sign-in the target opens. Repeat with Google and
  with Apple sign-in.
- **Deleted or unpublished id** (and a random valid uuid) → "no longer available".
  `/playlist/create` and a malformed id → home, not a crash.
- **App not installed** (second device, or uninstall):
  - iOS shows the App Store badge and the Smart App Banner;
  - Android shows the Play badge;
  - desktop shows both badges plus "open on your phone".
  - There is no auto-redirect.
- **Android (APK):**
  - `adb shell pm get-app-links com.niitech.rhemapod` shows `open.rhemapod.com: verified`;
  - a WhatsApp tap opens the app with no chooser.
- **Old `rhemapod://sermon/<id>` links** still open the app.
- **Legal:** `https://open.rhemapod.com/privacy` → 301 → admin.

---

## Phase 2 — design (binding unless changed at `[HUMAN_GATE SL5]`)

### P.1 Migration (`[HUMAN_GATE SL4]`)
- One Alembic revision, with `down_revision` set to the current `alembic heads`:
  - `UPDATE playlists SET is_public = false`;
  - `ALTER COLUMN is_public SET DEFAULT false`.
- The model's `server_default` and `default` become false. `PlaylistCreate.is_public` defaults to
  false (`app/models/content_schemas.py` ~L937).
- **Downgrade** restores `server_default` true only. It does **not** restore per-row values.
  That's accepted, because `is_public` is read by nothing today, so the only information lost is
  a toggle that had no effect. Before the merge, S11 records the dev count of `is_public=false`
  rows in `status.md`.

### P.2 Non-owner read (`[HUMAN_GATE SL5]` — public API contract)
- **`GET /playlists/{playlist_id}`** (still authenticated):
  - the owner gets the same response as today;
  - a non-owner gets the playlist only if `is_public` is true **and** no `UserBlock` exists in
    either direction between viewer and owner (SL0 answer 5).
  - Every other case (missing, private, blocked) raises the **identical**
    `ContentError("Playlist not found", 404)`, so the response is never an existence oracle.
- **`PlaylistDetail` gains `is_owner: bool`.** For non-owners, `owner_name` is
  `public_display_name(owner.full_name)` (`app/services/content_service.py` ~L158). Owners keep
  `display_name`.
- **Items** reuse the existing viewer-visibility filter (`VIEWER_VISIBLE_STATUSES` + publish time).
  Entitlement and paywall behaviour on playback is unchanged: the recipient gets whatever the
  sermon screen already enforces.
- **Every mutating playlist endpoint** stays owner-only through `_get_owned_playlist` (unchanged).
  Tests assert that a non-owner gets 404 on PATCH, DELETE, items, order and cover for a public
  playlist.
- **`GET /playlists`** (list) still returns only the viewer's own playlists.
- **Make-public content rule** (SL0 answer 6): user-written `name`/`description` become visible to
  link recipients. When `is_public` is true after a create or PATCH, `name`/`description` must
  pass the existing comment rules (no URL, no contact details, no blocklisted term;
  `comments_service.py` ~L215–231). Otherwise the endpoint returns 400 with a typed message.
  Private playlists are not checked.
- `openapi.json` is regenerated. ADR 0021 gets a Phase 2 addendum only if this section changed at
  SL5.

### P.3 Mobile
- **Owner, playlist detail:** a Share action.
  - **Public playlist:** share right away (`<base>/playlist/<id>`).
  - **Private playlist:** show the Alert *"Make this playlist public? Anyone with the link can see
    it and its sermons. Your name shows as 'First L.'"* with No / Yes.
    - No cancels with nothing shared.
    - Yes awaits `PATCH {is_public: true}`. Only on success does it open the share sheet.
    - On failure (including the P.2 content-rule 400), show the error message and share nothing.
- **Recipient (`is_owner=false`):** a read-only view. It has play/queue as for any sermon list,
  and no edit, rename, reorder, cover, delete, add or "make private" controls. The owner shows as
  `owner_name`.
- **Create screen:** the public toggle defaults to off, matching P.1.
- **Types:** `npm run gen:api` in `mobile/` **and** `admin_portal/`. The portal gets only the type
  regen, with no code change.

---

## [HUMAN_GATE SL0] — Plan approval — **PASSED 2026-10-31**
Isaac, in chat: *"SL0 approved, go with recommendations but use open.rhemapod.com instead of
rhemapod.com to show the one-screen brand page"*. This plan already reflects that: the share host
is `open.rhemapod.com` everywhere, and `rhemapod.com` is not touched. Decisions (all planner
recommendations accepted):

1. **`/`** on `open.rhemapod.com` is the one-screen brand page: store badges plus links to the
   legal pages on `admin.rhemapod.com` (§D.3).
2. **Thumbnail:** the image attachment is dropped from shares so messengers show link cards.
   This explicitly reverses the 2026-10-09 image request; Isaac accepted (§D.4).
3. **No `?ref=share`** (§D.4).
4. **`www`:** not applicable (the apex isn't used).
5. **Blocks:** a block in either direction gives the same 404 as a private playlist (§P.2).
6. **Make-public content rule:** making a playlist public runs the existing comment rules on
   `name`/`description`, with a 400 on failure (§P.2).
7. **ADR 0021** is written in Phase 1 covering both phases, and accepted at SL2 (S1).

The executor records these in `status.md` as the first `SHARE-LINKS` entry.

## Phase 1 — Sermons + series

### S1 — ADR 0021 (Proposed) + deploy docs
- **Owner agent:** scribe
- **What:** Write `docs/adr/0021-https-share-links.md` (Proposed). It covers **both** phases,
  because all the decisions are already made:
  - the permanent URL contract, with the scheme kept forever;
  - host isolation (a separate static site on `open.rhemapod.com` with no admin surface, legal 301s, apex untouched);
  - the static no-data fallback page with no auto-redirect;
  - the AASA/assetlinks path scope and the `/playlist/create` exclude;
  - signing fingerprints (EAS now, Play at L1);
  - stash-and-replay;
  - playlist privacy, enforced with the private backfill;
  - the non-owner read contract (§P.2);
  - "First L.".

  Add a `DEPLOYMENT-RENDER.md` section "Share static site (open.rhemapod.com)": the service, DNS rules
  (§D.5), how to validate the association files, and the L1 reminder.
- **Files / scope:** `docs/adr/0021-https-share-links.md` (new), `DEPLOYMENT-RENDER.md`
- **Verification:** `pre-commit run --files <changed>` is green. The ADR's links resolve
  (`grep -o "plans/[^)]*\|docs/[^)]*"` paths exist).
- **Commit:** `docs(adr): ADR 0021 — https share links and open.rhemapod.com static site`
- **Status update:** `[S1] <files>`

### S2 — Static share site
- **Owner agent:** senior-dev-frontend (it first obtains the EAS SHA-256: `eas credentials -p
  android`, read-only, for profile `android-internal`. If Expo login isn't available, halt and ask
  Isaac for the fingerprint. It is public, not a secret.)
- **What:** Build `open_site/` per §D.1–§D.3. `index.html` is the brand page (§D.3). Badges use the
  official Apple and Google artwork, unmodified. The logo comes from `mobile/assets`.
- **Files / scope:** `open_site/**` (new)
- **Verification:**
  - `node --test open_site/tests/` covers:
    - a valid uuid for each type → the right `rhemapod://` href;
    - uppercase uuid accepted;
    - a trailing slash accepted;
    - `/playlist/create`, a non-uuid, an extra segment, `javascript:`-ish input and an encoded
      path → button hidden;
    - UA → badge selection.
  - `python3 -m json.tool` passes on both `.well-known` files.
  - `grep -n "fetch\|XMLHttpRequest\|http-equiv=\"refresh\"\|location\.\(href\|replace\|assign\)\s*=" open_site/*.html open_site/*.js`
    → no hits (reading `location.pathname` is allowed).
  - Open `open.html` locally in a browser → the layout works at 360 px and on desktop.
- **Commit:** `feat(open-site): static rhemapod.com site with share fallback and app association files`
- **Status update:** `[S2] <test counts, grep result, fingerprint source>`

### S3 — Render service entry
- **Owner agent:** noob-dev
- **What:** Add the `rhemapod-open` static service to `render.yaml`: `runtime: static`,
  `rootDir: open_site`, a no-op `buildCommand`, `staticPublishPath: .`, `branch: dev`,
  `domains: [open.rhemapod.com]`, and the `routes` + `headers` from §D.3. Touch no other service.
- **Files / scope:** `render.yaml`
- **Verification:**
  - YAML parses (`uv run python -c "import yaml,sys;yaml.safe_load(open('render.yaml'))"`, or
    whatever YAML tool is already present; no new dependency).
  - `git diff render.yaml` touches only the new block.
  - pre-commit is green.
- **Commit:** `chore(render): add rhemapod-open static site`
- **Status update:** `[S3] <diff summary>`

### [HUMAN_GATE SL1] — Merge S1–S3 to `dev`; create the static site; DNS (one CNAME, external)
Isaac approves the merge of the S1–S3 commits into `dev`. This is a fast-forward of just these
commits; the mobile work stays on the branch. Then:

1. Sync the Blueprint in the Render dashboard so `rhemapod-open` is created.
2. Add the `open` CNAME per §D.5.
3. Wait for Render to show the domain verified and the certificate issued.

No other DNS record changes.

### S4 — Live validation of open.rhemapod.com (blocks every native build)
- **Owner agent:** senior-dev-frontend
- **What:** Validate the deployed site. Record raw status lines and headers, not page bodies.
- **Files / scope:** read-only (`curl`, `dig`)
- **Verification:** all of these must hold:
  - `curl -sI https://open.rhemapod.com/.well-known/apple-app-site-association` → `200` with
    `content-type: application/json`. `curl -s -o /dev/null -w "%{redirect_url}"` → empty.
  - `curl -s https://app-site-association.cdn-apple.com/a/v1/open.rhemapod.com` → the same JSON. Apple's
    CDN can lag by hours; retry, and do not proceed until it matches.
  - `curl -s "https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=https://open.rhemapod.com&relation=delegate_permission/common.handle_all_urls"`
    → a statement for `com.niitech.rhemapod` with the S2 fingerprint.
  - `curl -sI https://open.rhemapod.com/sermon/<uuid>` → 200, `x-robots-tag: noindex`, no `location`.
  - `/privacy` → `301` to `https://admin.rhemapod.com/privacy`.
  - `/` → 200 brand page. TLS is valid (`curl` with no `-k`).
  - `dig +short open.rhemapod.com CNAME` → the Render host.
- **Status update:** `[S4] <each check: pass/fail + status line>`

### S5 — Mobile association config + `+native-intent` allow-list
- **Owner agent:** mobile-developer
- **What:**
  - Inventory every inbound-URL use (`grep -rn "rhemapod://\|Linking\.\|getInitialURL\|useURL\|redirectSystemPath" mobile/app mobile/lib`)
    and record it.
  - Add `associatedDomains` and `intentFilters` per §D.4.
  - Create `app/+native-intent.tsx` with a pure, exported allow-list function.
- **Files / scope:** `mobile/app.json`, `mobile/app/+native-intent.tsx` (new),
  `mobile/lib/linking/allowList.ts` (new), `mobile/lib/linking/__tests__/allowList.test.ts` (new)
- **Verification:**
  - Jest covers:
    - https and scheme forms for all 3 types → the same route;
    - uppercase uuid;
    - trailing slash;
    - query string dropped;
    - `/playlist/create`, unknown path, non-uuid, foreign host (`https://evil.com/sermon/<uuid>`),
      `http://` (not https) host link → `/`;
    - every path from the inventory preserved.
  - `npx expo config --type introspect` shows `com.apple.developer.associated-domains` =
    `applinks:open.rhemapod.com` and the Android filter with `autoVerify`.
  - `npx tsc --noEmit && npx jest` is green.
- **Commit:** `feat(mobile): https universal/app links with deep-link allow-list`
- **Status update:** `[S5] <inventory, test counts, introspect excerpt>`

### S6 — Signed-out stash-and-replay + cold-start back target
- **Owner agent:** mobile-developer
- **What:** Implement §D.4 stash-and-replay inside `lib/auth/AuthContext.tsx` (or a small
  `lib/linking/pendingLink.ts` it calls), and the home-first stack on cold start. `useAuthGuard`'s
  existing (tabs) guarding is unchanged apart from consuming the stash after sign-in.
- **Files / scope:** `mobile/lib/auth/AuthContext.tsx`, `mobile/lib/linking/pendingLink.ts` (new),
  `mobile/app/+native-intent.tsx`, tests under `mobile/lib/**/__tests__/`
- **Verification:**
  - Jest covers:
    - stash while signed out → the sign-in success path replays exactly once;
    - TTL expiry → no replay;
    - sign-out clears the stash;
    - a second link overwrites the first;
    - a signed-in link → no stash;
    - cold start → the stack is home then target (router mock at the navigation boundary only).
  - tsc and jest are green.
- **Commit:** `feat(mobile): replay shared link after sign-in; home as cold-start back target`
- **Status update:** `[S6] <test counts>`

### S7 — "No longer available" states + https share message
- **Owner agent:** mobile-developer
- **What:**
  - Add the not-available states for sermon, series and playlist detail (§D.4).
  - Point `shareContent.ts` at the https base per §D.4: no image attachment, no `?ref=share`.
  - Update the doc comment.
- **Files / scope:**
  - `mobile/lib/share/shareContent.ts` (+ test), `mobile/lib/api/config.ts` (base-URL read);
  - `mobile/app/sermon/[id].tsx`, `mobile/app/series/_detail/useSeriesScreen.ts`;
  - the playlist, sermon and series detail empty-state components;
  - `mobile/.env.example` (if present), with `EXPO_PUBLIC_SHARE_BASE_URL` commented as optional.
- **Verification:**
  - Jest covers:
    - the message ends with `https://open.rhemapod.com/sermon/<id>`;
    - the env override is respected;
    - no `rhemapod://` remains in the share output;
    - no image attachment is passed to the share sheet;
    - a 404 renders the not-available state for each of the 3 screens, with Go home navigating
      to `/`.
  - `grep -rn "rhemapod://" mobile/lib/share` → no hits.
  - tsc and jest are green.
- **Commit:** `feat(mobile): share https links; not-available states for shared content`
- **Status update:** `[S7] <test counts>`

### S8 — Phase 1 review
- **Owner agent:** reviewer-gilfoyle, security-reviewer and qa-strategist (in parallel, on the
  S1–S7 diff); then ui-designer, for a short read of the copy and layout of `open.html` and the
  not-available states only
- **What:**
  - **Gilfoyle:** correctness, allow-list edge cases, auth-flow replay races, CNG config.
  - **Security:**
    - open-redirect and scheme injection through `open.js` and `+native-intent`;
    - AASA/assetlinks scope;
    - no data, ID or third party on the static page;
    - headers and CSP;
    - the DNS change is the single `open` CNAME.
  - **QA:** finalise §D.6 into a numbered checklist with expected results, and name coverage
    gaps.
- **Files / scope:** read-only
- **Verification:** all reports are in `status.md`, with no open BLOCKER or HIGH. Fixes go back to
  S2/S5–S7 under the same conventions (`fix(mobile): …`, `fix(open-site): …`). Share-site fixes need another
  merge at SL2.
- **Status update:** `[S8] <verdicts, findings, fix commits, final checklist>`

### [HUMAN_GATE SL2] — Accept ADR 0021; merge Phase 1 to `dev`; start builds (cost + Apple capability)
Precondition: S4 is fully green **at the time of the build**, because iOS fetches AASA at install.
Isaac approves:

- ADR 0021, Proposed → Accepted;
- the S8 verdicts;
- the merge into `dev`;
- two EAS builds: `eas build -p ios --profile testflight` and
  `eas build -p android --profile android-internal`.

The iOS build enables the **Associated Domains** capability on the App ID through EAS-managed
credentials. That's an Apple account change, and Isaac must be able to authenticate. TestFlight
submission follows the existing flow.

### S9 — On-device verification (Phase 1)
- **Owner agent:** qa-strategist (drives the checklist); Isaac executes on the devices;
  mobile-developer is on call for failures
- **What:** Run the S8 checklist on the TestFlight build (iPhone) and the APK (Android).
- **Files / scope:** none (devices); results go to `status.md`
- **Verification:** each checklist line is pass/fail, with build numbers. Any fail → back to the
  owning step, then a new build (SL2 again for the build).
- **Status update:** `[S9] <build ids, per-line results, pm get-app-links output>`

### S10 — Phase 1 close-out
- **Owner agent:** scribe
- **What:** Update the `plans/README.md` row outcome. Note in `DEPLOYMENT-RENDER.md` any fact
  learned in S4/S9, such as Apple CDN lag or Render header quirks.
- **Files / scope:** `plans/README.md`, `DEPLOYMENT-RENDER.md`
- **Verification:** pre-commit is green.
- **Commit:** `docs: share links phase 1 close-out`
- **Status update:** `[S10] <files>`

### [HUMAN_GATE SL3] — Phase 1 sign-off
Isaac accepts the S9 results. Phase 2 may start (a branch cut from `dev`).

## Phase 2 — Playlists

### S11 — Migration: playlists private by default
- **Owner agent:** senior-dev-backend
- **What:** Implement §P.1 (revision + model + DTO default). Record the dev `is_public=false` count
  (read-only query through the existing ops path) in `status.md`.
- **Files / scope:** `alembic/versions/<new>.py`, `app/models/models.py` (~L1336),
  `app/models/content_schemas.py` (~L937), `tests/test_playlists*.py` (or a new
  `tests/test_playlist_privacy_migration.py`)
- **Verification:**
  - Testcontainers covers:
    - upgrade on a DB seeded with public and private playlists → all false;
    - a new row with the column omitted → false;
    - `POST /playlists` without `is_public` → false;
    - downgrade → default true, rows unchanged;
    - upgrade again is clean.
  - `uv run alembic heads` → single head. Full suite and pre-commit are green.
- **Commit:** `feat(playlists): private by default; backfill existing playlists to private`
- **Status update:** `[S11] <counts, test names, head id>`

### [HUMAN_GATE SL4] — Schema change approval
Isaac reviews the revision text and approves:

- the backfill;
- the default flip;
- the non-restoring downgrade.

It applies on Render dev only at the SL6 merge.

### S12 — Non-owner read of public playlists
- **Owner agent:** senior-dev-backend
- **What:** Implement §P.2 in `playlists_service.py` (a new read path beside
  `_get_owned_playlist`, which is unchanged for mutations) and `app/api/playlists.py`. Add
  `is_owner` to `PlaylistDetail`. Apply the block rule and the make-public content rule as
  in §P.2. Update the stale "nothing reads it yet" comment block in `content_schemas.py`.
  Regenerate `openapi.json`.
- **Files / scope:** `app/services/playlists_service.py`, `app/api/playlists.py`,
  `app/models/content_schemas.py`, `openapi.json`, `tests/test_playlists*.py`
- **Verification:**
  - Testcontainers covers:
    - owner read is unchanged, with `is_owner=true` and the full name;
    - a non-owner on a public playlist → 200, `is_owner=false`, owner "First L.";
    - non-owner on private → 404, and non-owner on missing → 404, with the **same body**;
    - a block in each direction → the same 404;
    - an unpublished or future sermon item is hidden from the non-owner;
    - non-owner PATCH, DELETE, items, order, cover → 404;
    - unauthenticated → 401;
    - the content rule: a URL in the name when going public → 400, and private stays allowed (if
      adopted).
  - The `openapi.json` diff shows only the playlist additions.
  - Full suite and pre-commit are green.
- **Commit:** `feat(playlists): signed-in non-owners can read public playlists`
- **Status update:** `[S12] <test counts, openapi diff summary>`

### [HUMAN_GATE SL5] — Public API contract approval
Isaac reviews the `openapi.json` diff and the S12 behaviour (404 uniformity, block rule, "First L.",
content rule). If anything changed from §P.2, scribe appends a Phase 2 addendum to ADR 0021 before
S13.

### S13 — Mobile: owner share, make-public prompt, recipient view
- **Owner agent:** mobile-developer
- **What:** Implement §P.3. Regenerate the types in `mobile/` and `admin_portal/`
  (`npm run gen:api`).
- **Files / scope:**
  - `mobile/lib/api/schema.d.ts`, `admin_portal/lib/api/schema.d.ts`;
  - `mobile/app/playlist/[id].tsx`, `mobile/app/playlist/_detail/**`,
    `mobile/app/playlist/create.tsx`;
  - `mobile/lib/share/shareContent.ts` (only if a playlist path helper is needed);
  - tests under `mobile/app/playlist/__tests__/`.
- **Verification:**
  - Jest covers:
    - public → the share sheet opens with no PATCH;
    - private + No → no PATCH, no share;
    - private + Yes + PATCH ok → PATCH then share, in that order;
    - private + Yes + PATCH fail/400 → error shown, no share;
    - `is_owner=false` → no edit, rename, reorder, cover, delete or add controls, and the owner
      label rendered;
    - the create toggle defaults off.
  - mobile tsc and jest are green. Portal `npm run verify` is green (types only, no code diff
    beyond `schema.d.ts`).
- **Commit:** `feat(mobile): share playlists with make-public prompt; read-only recipient view`
- **Status update:** `[S13] <test counts>`

### S14 — Phase 2 review
- **Owner agent:** reviewer-gilfoyle, security-reviewer and qa-strategist (in parallel, on the
  S11–S13 diff)
- **What:**
  - **Gilfoyle:** migration safety, query shape (no N+1 on the non-owner read), dependency
    direction.
  - **Security:**
    - IDOR on every playlist endpoint;
    - 404 uniformity (body and timing-insensitive paths);
    - block handling;
    - name leakage (no full name or email to non-owners);
    - user-generated text exposure;
    - entitlement bypass through playlist items.
  - **QA:** the Phase 2 on-device checklist:
    - owner share public/private, Yes/No, offline PATCH failure;
    - recipient signed-out replay to the playlist;
    - private → recipient sees not-available;
    - a blocked pair;
    - the owner makes it private again → the recipient's next open is not-available.
- **Files / scope:** read-only
- **Verification:** reports are in `status.md`, with no open BLOCKER or HIGH. Fixes go back to
  S11–S13.
- **Status update:** `[S14] <verdicts, findings, fix commits, checklist>`

### [HUMAN_GATE SL6] — Merge Phase 2 to `dev` (applies the migration on Render dev) + builds
Isaac approves the S14 verdicts and the merge. That **irreversibly** backfills every dev playlist
to private, and the API start runs `alembic upgrade head`. He also approves the new
`testflight` + `android-internal` builds. After the deploy, the executor confirms the playlist
count and the false-count by a read-only query and records them.

### S15 — On-device verification (Phase 2) + close-out
- **Owner agent:** qa-strategist (drives), Isaac (devices), mobile-developer (on call); scribe
  for the README row
- **What:** Run the S14 checklist on the new builds. Update the `plans/README.md` outcome.
- **Files / scope:** `plans/README.md`
- **Verification:** each line is pass/fail with build ids. pre-commit is green on the README
  change.
- **Commit:** `docs: share links phase 2 close-out`
- **Status update:** `[S15] <build ids, per-line results>`

### [HUMAN_GATE SL7] — Phase 2 sign-off (final review)
Isaac accepts the results. The plan closes, with L1 still owed.

## Launch checklist (owed at M11, not part of SL7)

### L1 — Add the Play app-signing SHA-256 before the first Play release
- **Owner agent:** senior-dev-frontend (Isaac supplies the fingerprint from Play Console → App
  integrity)
- **What:** Append the Play app-signing SHA-256 to `open_site/.well-known/assetlinks.json`,
  keeping the EAS one. Change nothing else: no AASA change, no path change, no flag.
- **Verification:**
  - Google's DAL API lists both fingerprints.
  - A Play-installed build shows `verified` in `pm get-app-links`.
- **Commit:** `chore(open-site): add Play app-signing fingerprint to assetlinks`
- **Gate:** it rides `[HUMAN_GATE M11]` (plan-mobile-app) as a merge into `dev`.

## Rollback

- **Static site:**
  - Delete `rhemapod-open` in Render and revert S2/S3. Isaac removes the `open` CNAME.
  - Installed apps then fall back to opening https links in the browser, which 404 there. The
    scheme links in older shares keep working.
  - To keep the site but stop app interception, change the next item instead.
- **AASA / assetlinks path removal:**
  - Remove a path (or all components) from AASA, and/or empty the assetlinks statements, then
    redeploy the site.
  - iOS honours this after Apple's CDN refreshes (hours to about a day). Android honours it on
    re-verification.
  - No app release is needed to stop interception. The fallback page still serves.
- **Mobile:** revert the S5–S7 / S13 commits and ship a new build. Without OTA, a bad binary is
  only fixed by the next build. TestFlight builds can be expired in App Store Connect.
- **Migration:** run `uv run alembic downgrade -1` (as its own step), which restores
  `server_default` true. **The per-row values are not restored**; that loss was accepted at SL4.
  Revert S11/S12 so non-owner reads stop. Then make individual playlists public again only on
  owner action.
- **API:** reverting S12 returns non-owner reads to 404 everywhere. Mobile's recipient view
  degrades to "no longer available" (S7), with no crash.

## Risks

- **AASA caching.** Apple's CDN caches AASA, and devices fetch it at install or update. A wrong
  AASA at build time can mean links don't open until the next app update. S4 must pass before
  SL2.
- **Share host on a dev-tracking service.** Today the permanent public URL is served from `dev`. A bad
  merge to `dev` that touches `open_site/` breaks links for everyone. Mitigations:
  `open_site/` changes are rare, and every S-step diff is reviewed. Move the service to the prod
  branch when one exists.
- **Render free static sites** don't sleep, but Render's routes/headers semantics (dotfile
  serving, exact 301 code, header precedence) are verified only live in S4. If a header can't be
  set, halt and amend; don't work around it with redirects.
- **DNS:** a single new subdomain CNAME; the apex, mail and other records are untouched, so the
  blast radius is `open.` only.
- **No OTA.** Every mobile fix costs a build and a TestFlight cycle.
- **Instagram and other in-app browsers** never trigger Universal Links. The fallback button
  covers them, by design.
- **User-generated playlist text** becomes link-visible in Phase 2. The SL0 content rule is the
  control; there is still no report or abuse handling for playlists.
- **Generic link preview.** Recipients see a RhemaPod brand card, not the sermon artwork (the
  trade-off for a data-free page). Isaac accepted this at SL0 (answer 2).
