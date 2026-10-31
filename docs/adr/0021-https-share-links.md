# ADR 0021: https share links on open.rhemapod.com

- Status: Proposed (acceptance at `[HUMAN_GATE SL2]`)
- Date: 2026-10-31
- Deciders: Isaac (+ planner, architect, skeptic, scribe)
- Plans: `plans/plan-share-links.md` (§D.1-D.5, §P.1-P.3, §L1)
- Relates to: ADR 0017 (public contract), ADR 0020 (account deletion; legal pages on `admin.rhemapod.com`)

> A share link is `https://open.rhemapod.com/{sermon,series,playlist}/<uuid>`. It opens the app when installed, and a static page with no data when not. That URL shape is permanent.

## Context

- The current share link is `rhemapod://...`. Messengers don't make it tappable.
- Universal Links (iOS) and App Links (Android) need an https host serving association files.
- The API has no anonymous read and must not gain one. Recipients sign in to see content.
- Tester feedback 2026-10-31 asked for tappable links. Isaac approved the plan at SL0 and moved the host from the apex to `open.rhemapod.com`.
- `rhemapod.com` (apex) is not touched. `admin.rhemapod.com` hosts the portal and the legal pages.

## Decision

Serve share links from a dedicated Render Static Site (`rhemapod-open`, built from `open_site/`) on `open.rhemapod.com`. The site has no admin surface and no API calls. Phase 1 ships sermons and series. Phase 2 adds playlists. Both phases are decided here; details below are binding.

### 1. URL contract (permanent)

- Paths: `/sermon/<uuid>`, `/series/<uuid>`, `/playlist/<uuid>`. They match the app routes (`app/sermon/[id].tsx`, `app/series/[id].tsx`, `app/playlist/[id].tsx`).
- The host and path scheme are kept forever, because old shares live in chat history. Changing either breaks every link already sent.
- The `rhemapod://` scheme stays forever. Old `rhemapod://sermon/<id>` links keep opening the app.
- No `?ref=share` or other query parameters. Nothing consumes them.

### 2. Host isolation

- Separate static site, not a path on the portal. A bad portal deploy or a portal route can't affect the association files, and the site can carry a strict CSP.
- DNS is one record: `CNAME open`. No other record changes.
- Legal paths (`/privacy`, `/terms`, `/support`, `/delete-account`, `/guidelines`) 301 to the same path on `admin.rhemapod.com`.
- `/` is a one-screen brand page: logo, one line, store badges, legal links. Static, no script.
- Site-wide headers: `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, CSP `default-src 'self'; img-src 'self'; script-src 'self'; style-src 'self'`. Content paths add `X-Robots-Tag: noindex`.

### 3. Fallback page (static, no data)

- One `open.html` served by rewrite for `/sermon/*`, `/series/*`, `/playlist/*`. No network calls, no content ID in the HTML, `noindex`, no analytics, no cookies.
- Generic brand OG/Twitter tags and a Smart App Banner with no `app-argument`.
- `open.js` matches `location.pathname` against the strict uuid pattern and, on a match, points the "Open in RhemaPod" button at `rhemapod://<type>/<uuid>`. Otherwise it hides the button. It never writes the ID into visible text.
- Store badge by user agent (App Store, Play, or both plus "Open this link on your phone"). Both badges show without JS.
- **No auto-redirect** (no meta refresh, no `location` assignment). In-app browsers such as Instagram never trigger Universal Links, so the button is the way in.

### 4. Association files

- **AASA** (`/.well-known/apple-app-site-association`): components format only (minimum iOS is 15.1), `appIDs: ["FAND2W5VMM.com.niitech.rhemapod"]`. `/playlist/create` is excluded first, then `/sermon/*`, `/series/*`, `/playlist/*`. No `webcredentials`, no `appclips`.
- **assetlinks.json:** one `delegate_permission/common.handle_all_urls` statement for `com.niitech.rhemapod`.
- Both are served as `Content-Type: application/json` with no redirect.
- The app claims `/playlist/*` from Phase 1 on, so a non-owner opening a playlist link before Phase 2 gets the "no longer available" state, not a crash.

### 5. Signing fingerprints

- **Now:** the EAS keystore SHA-256 (the `android-internal` APK and TestFlight-era builds).
- **Before the first Play release (plan §L1, owed at M11):** append the Play app-signing SHA-256 to `assetlinks.json`, keeping the EAS one. No AASA or path change.

### 6. App handling

- `app/+native-intent.tsx` allows only `/(sermon|series|playlist)/<uuid>`. `/playlist/create`, unknown paths, query junk and foreign hosts go home. Existing legitimate inbound `rhemapod://` uses are inventoried and preserved first (plan S6).
- **Stash-and-replay:** a content link arriving signed out is held in memory (one slot, last wins, 60-minute TTL — Isaac 2026-10-31, to cover sign-up with email verification), the user signs in, then it replays once. Sign-out clears it. Nothing is written to disk.
- A cold start builds the stack home → target so Back lands on home.
- Each of sermon, series and playlist has a calm "no longer available" state for 404, unpublished and invisible items.
- Share message is title, truncated description, link. The image attachment is dropped so messengers show a link card. This reverses the 2026-10-09 thumbnail request; Isaac accepted it at SL0.
- Base URL comes from `EXPO_PUBLIC_SHARE_BASE_URL`, default `https://open.rhemapod.com`.

### 7. Playlist privacy (Phase 2)

- Existing playlists are backfilled to `is_public=false` and the column default becomes false (`PlaylistCreate.is_public` too). Nothing read `is_public` before, so the only loss is a toggle that had no effect. The downgrade restores the default only, not per-row values.
- Making a playlist public runs the comment rules on `name` and `description` (no URL, contact details or blocklisted term). Failure is a 400. Private playlists aren't checked.

### 8. Non-owner read contract (Phase 2)

- `GET /playlists/{id}` stays authenticated. The owner's response is unchanged.
- A non-owner gets the playlist only if `is_public` is true and no `UserBlock` exists in either direction.
- Missing, private and blocked all raise the identical `ContentError("Playlist not found", 404)`. The response is not an existence oracle.
- `PlaylistDetail` gains `is_owner: bool`. For non-owners `owner_name` is `public_display_name(full_name)`, shown as "First L.". Owners keep `display_name`.
- Items reuse the viewer-visibility filter. Playback entitlement and paywall behaviour are unchanged.
- Every mutating endpoint stays owner-only (`_get_owned_playlist`). `GET /playlists` still lists only the viewer's own.
- If this section changes at `[HUMAN_GATE SL5]`, a Phase 2 addendum records it.

## Consequences

- Positive: links are tappable in messengers. Old `rhemapod://` links keep working. The static site has no data and no admin surface, so it has a small attack surface. Stopping app interception needs no app release (edit the association files and redeploy).
- Negative:
  - Link previews are a generic brand card, not sermon artwork. Per-content previews would need a server-rendered page reading data, which this design rejects.
  - Every mobile change needs a new binary (no OTA).
  - The permanent public URL is served from a `dev`-tracking service until a prod stack exists; a bad `open_site/` merge breaks links for everyone.
  - Apple's CDN caches AASA, so a wrong file at build time can leave links dead until the next app update.
  - Playlist text becomes link-visible in Phase 2. The comment rule is the only control. There is no report or abuse handling for playlists.
- Neutral: one new free Render service and one DNS record. The Play fingerprint is a launch-time chore (§5).

## Alternatives considered

- **Serve from the apex `rhemapod.com`:** rejected because it ties the permanent share path to the marketing/brand host and risks the apex. A subdomain isolates the blast radius.
- **Path on `admin.rhemapod.com`:** rejected because it couples association files to portal deploys and the portal's auth surface.
- **Server-rendered preview page with real OG tags:** rejected because it needs a data read for anonymous visitors, which the API deliberately doesn't allow.
- **Auto-redirect from the fallback page into the app:** rejected. It's unreliable across in-app browsers and breaks Back.
- **Keep `rhemapod://` only:** rejected because it isn't tappable in messengers.
- **A third-party deep link service:** rejected because it adds a dependency, a data processor and a lock-in for a permanent URL.
- **Leave existing playlists public by default:** rejected because users never chose it; the backfill makes sharing an explicit act.
