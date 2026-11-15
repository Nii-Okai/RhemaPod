# Code comment history

Until November 2026 many comments in `mobile/` also told the story of how the code got there: who asked for a change and on which session date, what the code used to do, which review finding prompted a fix, and so on. That history now lives here so the comments in the source can explain the code as it is.

Each section below is one file. Lines starting with `-` are the comment text as it was before the cleanup; lines starting with `+` are what replaced it (nothing, when the comment was only history). The file and line numbers refer to the code at the commit before the cleanup (see `git log -- mobile/docs/history/code-comment-history.md`).

For the wider account of each change, see the merged pull requests.

## `.env.example`

```diff
@@ line 9
-# Google Sign-In OAuth client IDs (Google Cloud Console — Credentials). Isaac is creating
-# these himself; placeholders here are a drop-in once he sends the real values. The iOS
+# Google Sign-In OAuth client IDs (Google Cloud Console — Credentials). The iOS
```

## `app/(auth)/_components/__tests__/field.test.tsx`

```diff
@@ line 15
-  it('masks a password field by default and reveals it on toggle (session 2026-10-15: "add feature to allow viewing password")', () => {
+  it('masks a password field by default and reveals it on toggle', () => {
```

## `app/(auth)/_components/auth-screen.tsx`

```diff
@@ line 14
- * Laid out and ordered as before the Daybreak redesign (Nii, 2026-11-12: "maintain the
- * layout and ordering from the previous design"), in Daybreak's colours and type:
+ * Daybreak's colours and type, in this layout and order:
@@ line 25
- * Anchored near the top rather than vertically centred (Isaac, 2026-10-16: a short form
- * read as floating low when centred). Sign in opts into `centerVertically` (Isaac,
- * 2026-11-12: "center the sign in page").
+ * Anchored near the top rather than vertically centred (a short form reads as floating
+ * low when centred). Sign in opts into `centerVertically`.
```

## `app/(auth)/_components/field.tsx`

```diff
@@ line 27
- * `secureTextEntry` fields (Isaac's ask, session 2026-10-15: "add feature to
- * allow viewing password") get a show/hide eye toggle for free — the field
+ * `secureTextEntry` fields get a show/hide eye toggle for free — the field
@@ line 31
- * `secureTextEntry` renders exactly as before, no toggle, no layout change.
+ * `secureTextEntry` has no toggle.
```

## `app/(auth)/_components/or-divider.tsx`

```diff
@@ line 9
- * stacked social buttons (sign-in.tsx / register.tsx, Isaac's ask, session 2026-10-15:
- * "organise the page to look better").
+ * stacked social buttons (sign-in.tsx / register.tsx).
```

## `app/(auth)/_components/social-sign-in-button.tsx`

```diff
@@ line 16
- * "Continue with Google/Apple": Daybreak's 54pt outlined pill (canvas A3). Originally the bordered-surface look (Isaac's ask, session
- * 2026-10-15), not a filled gold pill (reserved for the primary "Sign in" action, see
+ * "Continue with Google/Apple": Daybreak's 54pt outlined pill (canvas A3). A bordered
+ * surface, not a filled gold pill (reserved for the primary "Sign in" action, see
```

## `app/(auth)/_layout.tsx`

```diff
@@ line 9
-        // Each auth screen draws its own round back button (Daybreak A4 to A6); the native
-        // header doubled it up on sign up (Nii's phone test, 2026-11-11).
+        // Each auth screen draws its own round back button (Daybreak A4 to A6), so the
+        // native header would double it up.
```

## `app/(tabs)/_announcements/SignatureAnnouncements.tsx`

```diff
@@ line 226
- * Announcements, Signature redesign (Nii's ask, 2026-10-22: "feel free to redesign
- * announcement screen"), behind `SIGNATURE_ANNOUNCEMENTS_ENABLED`. Same data as the
+ * Announcements, Signature design, behind `SIGNATURE_ANNOUNCEMENTS_ENABLED`. Same data as the
@@ line 259
-        {/* Back sits on the title's row (Nii, 2026-11-11); the LIVE pill moves up beside
+        {/* Back sits on the title's row; the LIVE pill moves up beside
```

## `app/(tabs)/_browse/signature/SignatureBrowse.tsx`

```diff
@@ line 57
- * Discover (formerly Browse). Signature redesign (Nii's approved mockup, 2026-10-21),
- * reworked for the Daybreak redesign (2026-11, canvas B3): "What do you need today?"
+ * Discover (the Browse tab). Daybreak design (canvas B3): "What do you need today?"
```

## `app/(tabs)/_downloads/DownloadRow.tsx`

```diff
@@ line 19
-// A square thumbnail at `LIST_THUMBNAIL_SIZE`, matching `PlaylistCard` (Isaac's ask,
-// session 2026-10-10: "Playlist and download list items should match size") — was a
-// wider 16:9 rectangle before. Overlay chip/icon/ring sized down to fit the smaller
+// A square thumbnail at `LIST_THUMBNAIL_SIZE`, matching `PlaylistCard`, so playlist and
+// download rows read as one list. Overlay chip/icon/ring sized down to fit the smaller
@@ line 38
-  // ready — category replaces the old generic "Downloaded" label (Isaac's ask, session
-  // 2026-10-09), size stays alongside it; a sermon with no category on file just shows
+  // ready — the category, with the size alongside it; a sermon with no category on file just shows
@@ line 46
-/** One row per sermon in the Downloads list (redesigned, Isaac's ask, session 2026-10-09:
- * a real thumbnail with the state's action overlaid on it — play when ready, retry when
- * failed, the same `CircularProgress` ring every other download control in the app uses
- * while active — in place of the old generic title+"Downloaded"+right-side icon layout.
- * The thumbnail *is* the tap target for that state's primary action.
+/** One row per sermon in the Downloads list: a real thumbnail with the state's action
+ * overlaid on it — play when ready, retry when failed, the same `CircularProgress` ring
+ * every other download control in the app uses while active. The thumbnail *is* the tap
+ * target for that state's primary action.
@@ line 52
- * A small gold checkmark precedes the category text once the download is `ready` (Isaac's
- * ask, session 2026-10-10: "add a downloaded checked icon before category ... to show the
- * difference") — now that playlist and download rows are visually unified in one list with
- * no section header, this is the one thing that marks a row as a download rather than a
- * playlist. It's gated on `isReady` specifically, not just "is a download": a downloading/
+ * A small gold checkmark precedes the category text once the download is `ready` —
+ * playlist and download rows share one list with no section header, so this is the one
+ * thing that marks a row as a download rather than a playlist. It's gated on `isReady` specifically, not just "is a download": a downloading/
@@ line 60
- * Long-press anywhere on the row opens a delete confirm (same session — replaces
- * `SwipeToDelete`, which doesn't fit this screen's now-interleaved list/grid as cleanly as
- * one consistent long-press gesture across every row and grid tile does). The whole row is
- * one `Pressable` rather than a separate thumbnail-Pressable-inside-a-row (the swipe
- * wrapper's old shape) specifically so long-press and short-press share one hit target.
+ * Long-press anywhere on the row opens a delete confirm: one consistent gesture across
+ * every row and grid tile of the interleaved list/grid, where a swipe doesn't fit. The
+ * whole row is one `Pressable` rather than a thumbnail-Pressable-inside-a-row so
+ * long-press and short-press share one hit target.
@@ line 69
- * without the gesture at all, via the same `accessibilityActions` entry `SwipeToDelete`
- * used to expose — parity, not a downgrade, for screen-reader users.
+ * without the gesture at all, via an `accessibilityActions` entry (the same one
+ * `SwipeToDelete` exposes).
```

## `app/(tabs)/_home/HeroCard.tsx`

```diff
@@ line 17
-      the overlaid, scroll-fading `HomeTopBar` (Isaac's ask, session 2026-09-30) when
+      the overlaid, scroll-fading `HomeTopBar` when
@@ line 28
- * Isaac's later reference (a church media app's own hero) overlays its title/meta directly
- * on the art too — but that art was custom-designed with a reserved, uncluttered gradient
- * area at the bottom specifically for that overlay. Our actual sermon thumbnails are flat
- * title-card graphics with baked-in text running edge-to-edge (verified against the real
- * "Understanding the Prophetic" thumbnail in testing) — there's no safe area to overlay free
- * text onto without covering something. So the only things that sit on the art are
+ * Heroes that overlay title/meta on the art rely on art designed with an uncluttered
+ * area for it. Our sermon thumbnails are flat title-card graphics with baked-in text
+ * running edge-to-edge — there's no safe area to overlay free text onto without
+ * covering something. So the only things that sit on the art are
@@ line 47
- * "My List" is a real playlist now (Isaac's ask, session 2026-10-11: "add sermon to
- * default library" — this was a local `useState` toggle before, doing nothing past a
- * remount; see `useAddToDefaultLibrary`'s own doc comment for the "default" convention).
- * Once added, the circle shows a checkmark — tapping it again removes the sermon
- * (Isaac's ask, session 2026-10-11: "allow user toggle"; it was a one-way add-only
- * button the one session prior).
+ * "My List" adds the sermon to the viewer's default playlist (see
+ * `useAddToDefaultLibrary`'s own doc comment for the "default" convention). Once added,
+ * the circle shows a checkmark — tapping it again removes the sermon.
@@ line 186
-    // On the art, not on chrome: the light pill in both themes (Isaac's decision,
-    // light-mode review §4.2) — a theme-following dark pill would vanish on dark art.
+    // On the art, not on chrome: the light pill in both themes (light-mode review
+    // §4.2) — a theme-following dark pill would vanish on dark art.
```

## `app/(tabs)/_home/HeroCarousel.tsx`

```diff
@@ line 20
-      (Isaac's ask, session 2026-09-30). See `HeroCard`'s own `topInset` doc comment. */
+      See `HeroCard`'s own `topInset` doc comment. */
@@ line 30
- * Home's hero (Isaac's ask, session 2026-09-30: 3 items instead of 1, auto-scrolling —
- * Prime Video/Disney+'s rotating-hero pattern). Backed by `useHeroSermons` (`GET
+ * Home's hero: up to 3 sermons, auto-scrolling (the rotating-hero pattern of streaming
+ * apps). Backed by `useHeroSermons` (`GET
@@ line 39
- * Nothing pages-related renders until that `onLayout` width actually lands (fixed
- * 2026-10-16, Isaac's report: the hero's art appeared to "grow, then snap back" between
- * a cold Home mount and a later revisit). The ScrollView/pages used to fall back to a
- * CSS `width: '100%'` for the one render before `onLayout` fired — percentage width on a
- * horizontal ScrollView's *paged* content is a known RN/Yoga gray area (the content
- * container's own main-axis size is itself intrinsic/shrink-to-fit, so a child's "100%"
- * of it is circular), and it resolved inconsistently between a cold mount and a later
- * remount (`(tabs)` has no persistent tab navigator under `Slot` — leaving and returning
- * to Home fully unmounts and remounts this component, and on a remount `useHeroSermons`
- * usually serves cached data synchronously, so that one-bad-frame render is far more
- * likely to actually paint than on a cold mount, where the hero sits behind a loading
- * skeleton for the whole first render anyway). `HeroCard`'s own art region uses a fixed
- * `aspectRatio`, so an indeterminate *width* is what was producing a differently-cropped
- * *height* — not a one-off glitch, a genuinely different pixel width computed each time.
- * The fix: render nothing inside `wrap` until `onLayout` reports a real pixel width, then
- * give every page that exact width — never a guess.
+ * Nothing pages-related renders until that `onLayout` width actually lands, and every
+ * page then gets that exact pixel width. A CSS `width: '100%'` fallback for the first
+ * render doesn't work: percentage width on a horizontal ScrollView's *paged* content is
+ * a known RN/Yoga gray area (the content container's main-axis size is itself
+ * shrink-to-fit, so a child's "100%" of it is circular) and resolves differently between
+ * mounts. Home remounts this component on every visit (`(tabs)` has no persistent tab
+ * navigator under `Slot`) and usually has cached data on a remount, so that first frame
+ * paints; with `HeroCard`'s fixed `aspectRatio`, a different width means a visibly
+ * different art height ("grow, then snap back").
@@ line 58
- * corners (`radius.sm`, tightened from `radius.xl` session 2026-10-01 to match Isaac's
- * Netflix reference — every home card now shares this same subtle radius) otherwise
- * expose a sliver of whatever's *behind* the card at
- * each corner during a drag, and an unstyled `ScrollView` renders that as iOS's default
- * white, not transparent (Isaac's report, session 2026-09-30: "white line on the right
- * when scrolling").
+ * corners (`radius.sm`, the radius every home card shares) otherwise expose a sliver of
+ * whatever's *behind* the card at each corner during a drag, and an unstyled `ScrollView`
+ * renders that as iOS's default white, not transparent (a white line on the right while
+ * scrolling).
```

## `app/(tabs)/_home/HomeHeader.tsx`

```diff
@@ line 62
-            being cut off (Nii's phone test, 2026-11-11). */}
+            being cut off. */}
```

## `app/(tabs)/_home/__tests__/HeroCarousel.test.tsx`

```diff
@@ line 12
-// react-query hook, for its real +/checkmark state (Isaac's ask, session 2026-10-11:
-// "add sermon to default library") — every render here needs a provider under it now.
+// react-query hook, for its real +/checkmark state —
+// every render here needs a provider under it now.
@@ line 80
-  // Regression (fixed 2026-10-16, Isaac's report — "hero grows in height, then snaps
-  // back"): before `onLayout` reports a real pixel width, the carousel renders nothing
+  // Regression (the hero grew in height, then snapped back): before `onLayout` reports a real pixel width, the carousel renders nothing
```

## `app/(tabs)/_home/signature/ArtScrim.tsx`

```diff
@@ line 8
- * SVG gradient: stacked flat bands showed as visible stripes over light artwork on a
- * phone (Nii's test, 2026-10-21). Dark in both themes — it sits on the art.
+ * SVG gradient: stacked flat bands show as visible stripes over light artwork on a
+ * phone. Dark in both themes — it sits on the art.
```

## `app/(tabs)/_home/signature/DailyRhemaCard.tsx`

```diff
@@ line 132
-// How see-through each part of the glass sun is. Kept low so it sits back in the card
-// (Nii, 2026-11-12: "the sun looks too bright"). Set as stop/stroke opacity, never as an
-// rgba alpha, which the first build showed does not come through on device.
+// How see-through each part of the glass sun is. Kept low so it sits back in the card.
+// Set as stop/stroke opacity, never as an rgba alpha, which does not come through on
+// device.
@@ line 138
- * The glass sun (Nii, 2026-11-12, canvas D7 option A): see-through gold, brighter at its
+ * The glass sun (canvas D7 option A): see-through gold, brighter at its
```

## `app/(tabs)/_home/signature/SeriesSpotlightCard.tsx`

```diff
@@ line 18
- * progress for `useSeriesWalk` to build one from (every brand-new account; Isaac's ask,
- * 2026-10-22: the section jumped straight to the plain two-column grid with no flame
- * treatment up top at all). Features one series (the caller's choice — `SignatureHome`
+ * progress for `useSeriesWalk` to build one from (every brand-new account), so the
+ * section still opens with the flame treatment rather than the plain grid. Features one series (the caller's choice — `SignatureHome`
```

## `app/(tabs)/_home/signature/SignatureHome.tsx`

```diff
@@ line 43
-/** The Series grid: one row of two (Nii's call, 2026-10-21); "See all" opens the full list. */
+/** The Series grid: one row of two; "See all" opens the full list. */
@@ line 128
- * Home, Signature redesign (Nii's approved mockup "RhemaPod — Signature", 2026-10-21),
- * reworked for the Daybreak redesign (2026-11, canvas B1/B2): a greeting header, then
+ * Home, Daybreak design (canvas B1/B2): a greeting header, then
```

## `app/(tabs)/_home/signature/VerseCard.tsx`

```diff
@@ line 24
-  // stray spaces mid-sentence (Nii's phone test, 2026-10-21). One flowing line reads right.
+  // stray spaces mid-sentence. One flowing line reads right.
```

## `app/(tabs)/_home/signature/__tests__/DailyRhemaCard.test.tsx`

```diff
@@ line 77
-it('draws the glass sun: see-through gold with a rim, not a solid disc (Nii, 2026-11-12)', async () => {
+it('draws the glass sun: see-through gold with a rim, not a solid disc', async () => {
```

## `app/(tabs)/_library/LibraryFilterPills.tsx`

```diff
@@ line 15
-/** "Playlists" / "Downloaded" filter pills (Isaac's screenshots — the
- * reference also shows "Artists", left out since this app has no artist-
- * library concept). Exclusive: selecting a pill filters the list to just
+/** "Playlists" / "Downloaded" filter pills. Exclusive: selecting a pill filters the list to just
```

## `app/(tabs)/_library/LibrarySortRow.tsx`

```diff
@@ line 17
-/** Sort control (left) + list/grid toggle (right) — Isaac's screenshots.
+/** Sort control (left) + list/grid toggle (right).
@@ line 19
- * while in list mode, a list icon while in grid mode), matching the
- * reference exactly. Tertiary tone throughout (text, icons) — a secondary
- * utility row sitting under the bolder filter pills, not a heading; the
- * reference's own "Recents" row reads as muted gray, not bright white. */
+ * while in list mode, a list icon while in grid mode). Tertiary tone
+ * throughout (text, icons) — a secondary utility row sitting under the
+ * bolder filter pills, not a heading. */
```

## `app/(tabs)/_library/LibrarySortSheet.tsx`

```diff
@@ line 22
-/** "Sort by" (Isaac's screenshots). Four options, same labels as the
- * reference — see `librarySort.ts`'s own doc comment for what each one
+/** "Sort by". Four options — see `librarySort.ts`'s own doc comment for what each one
```

## `app/(tabs)/_library/libraryLayout.ts`

```diff
@@ line 4
- * list, not two components that happen to sit in the same screen (Isaac's
- * ask, session 2026-10-10: "Playlist and download list items should match
- * size in image"). `PlaylistCard`, `DownloadRow`, `PlaylistGridTile`, and
+ * list, not two components that happen to sit in the same screen. `PlaylistCard`, `DownloadRow`, `PlaylistGridTile`, and
@@ line 11
-// 2, not 3 (Isaac's ask, session 2026-10-10: 3 columns left a visibly empty third
-// column on real devices) — `GRID_PADDING` must match `library.tsx`'s own screen
-// padding exactly (`spacing.xl`, not `spacing.lg`); a mismatch there was the actual
-// bug: `tileWidth` came out a few px wider than the row actually had room for, so a
-// 3rd tile often couldn't fit and wrapped to its own near-empty row instead of
-// filling out the row above it.
+// 2 columns. `GRID_PADDING` must match `library.tsx`'s own screen padding exactly
+// (`spacing.xl`, not `spacing.lg`): on a mismatch `tileWidth` comes out a few px wider
+// than the row has room for, and the last tile wraps to its own near-empty row.
```

## `app/(tabs)/_library/librarySort.ts`

```diff
@@ line 4
-/** A playlist and a download interleaved into one list (Isaac's ask, session
- * 2026-10-10: "remove section titles" + "playlist and download items should
- * look similar") — there's no section boundary between them any more, so
- * every list/grid in `library.tsx` works off this one discriminated union
+/** A playlist and a download interleaved into one list with no section boundary
+ * between them, so every list/grid in `library.tsx` works off this one discriminated union
@@ line 62
-/** Sorts a combined playlist+download list in place of what used to be two
- * separately-sorted arrays — see this file's own top doc comment for why a
+/** Sorts a combined playlist+download list — see this file's own top doc comment for why a
```

## `app/(tabs)/_library/signature/SignatureLibrary.tsx`

```diff
@@ line 47
- * Library, Signature redesign (Nii's ask, 2026-10-22: "feel free to redesign library
- * screens"), behind `SIGNATURE_LIBRARY_ENABLED`. Same data, sorting and actions as the
+ * Library, Signature design, behind `SIGNATURE_LIBRARY_ENABLED`. Same data, sorting and actions as the
@@ line 52
- * shelf, the You screen's segmented track for the filter (now with an explicit "All"
+ * shelf, the You screen's segmented track for the filter (with an explicit "All"
```

## `app/(tabs)/_me/ProfileAvatarPicker.tsx`

```diff
@@ line 32
- * Tap the Me page's own hero avatar to change it (Isaac's ask, session 2026-10-09:
- * "Allow to update profile picture") — an edit badge overlay signals it's interactive,
+ * Tap the Me page's own hero avatar to change it — an edit badge overlay signals it's interactive,
```

## `app/(tabs)/_me/ProfileDetailsSheet.tsx`

```diff
@@ line 32
- * Me page's own profile editor (Isaac's ask, session 2026-10-09: "Allow to update
- * firstname, lastname and gender") — a sibling of the comments flow's `NamePrompt`, not
+ * Me page's own profile editor (first name, last name and gender) — a sibling of the comments flow's `NamePrompt`, not
```

## `app/(tabs)/_me/signature/SignatureYou.tsx`

```diff
@@ line 150
- * You, Signature redesign (Nii's approved mockup "RhemaPod — Signature", 2026-10-21),
- * behind `SIGNATURE_YOU_ENABLED`. Every setting the classic `me.tsx` has, nothing new
- * (Nii: "keep every existing setting"), regrouped as the mockup draws it:
+ * You, Signature design, behind `SIGNATURE_YOU_ENABLED`. Every setting the classic
+ * `me.tsx` has, nothing new, grouped as:
```

## `app/(tabs)/_me/signature/ThemeSwitch.tsx`

```diff
@@ line 23
- * Appearance as one three-way switch — System / Light / Dark side by side (Nii's edit to
- * the Signature You mockup, 2026-10-21), replacing `AppearanceSection`'s three radio
- * rows. Same preference, same optimistic save and revert through `useTheme()`.
+ * Appearance as one three-way switch — System / Light / Dark side by side (the classic
+ * screen's `AppearanceSection` uses three radio rows). Same preference, same optimistic save and revert through `useTheme()`.
```

## `app/(tabs)/series.tsx`

```diff
@@ line 69
-        {/* Back sits on the title's row (Nii, 2026-11-11). */}
+        {/* Back sits on the title's row. */}
```

## `app/__tests__/search.test.tsx`

```diff
@@ line 178
-    // Duration/speaker dropped from the visible row (Isaac's ask, session 2026-10-02 —
-    // flat list matching the reference) but still reach VoiceOver.
+    // Duration/speaker dropped from the visible row (a flat list
+    // matching the reference) but still reach VoiceOver.
```

## `app/_layout.tsx`

```diff
@@ line 52
-        {/* First-launch onboarding (Isaac's mockups) — pre-auth, reached only from `/`'s own
+        {/* First-launch onboarding — pre-auth, reached only from `/`'s own
@@ line 61
-        {/* W4.1 — sermon-detail owns its own header (Cast+Close chrome, `CastCloseHeader`,
-            session 2026-10-01 — originally the platform-swapped `DetailHeader`, since
-            removed with no other consumers left), so the native Stack header is fully
-            disabled here rather than just given an empty title.
-            `gestureDirection: 'vertical'` + `fullScreenGestureEnabled` (Isaac's ask,
-            session 2026-10-01 — "pull down to go back, YouTube style") hands the whole
-            pull-to-dismiss interaction to `react-native-screens`' own native transition
-            instead of a hand-rolled one: the real previous screen shows through as it's
-            dragged, the drag tracks the finger exactly (native UIKit interactive
-            transition, not a JS-driven approximation), and a released-but-undercommitted
-            drag springs back with real velocity rather than a scripted-duration tween.
-            A from-scratch `Animated`-based version of this (session 2026-10-01, since
-            removed) got all three wrong: the ScrollView's own rubber-band and the
-            wrapper's transform fought each other, touches starting on the hero (outside
-            the ScrollView) produced no drag at all, and the exit was a fixed-duration
-            tween with no sense of how fast the finger was moving.
-            `animationDuration` here is one static value governing both the push-in and
-            the pop — Isaac's asks (session 2026-10-01) wanted open and close to differ,
-            but two attempts at dynamically overriding it per-direction via
-            `navigation.setOptions` both failed to visibly affect the close transition at
-            all (`react-native-screens` isn't reliably picking up a dynamic change for
-            this custom animation + `gestureDirection: 'vertical'` combination) — see
-            `detailTransition.ts`'s own doc comment for the full history. Reverted to the
-            one mechanism that's actually reliable: a single shared duration.
-            `animation: 'slide_from_bottom'` — a brief detour through `fade_from_bottom`
-            (session 2026-10-01, chasing a dark-overlay-on-the-revealed-screen effect that
-            turned out to need a genuine `presentation: 'modal'` switch, which Isaac
-            declined) was reverted back to this.
-            A tapped Related item pushes `sermon/related/[id]` below instead of this route
-            — a *second*, differently-configured route rendering the exact same screen
-            component (Isaac's ask, same session: the regular horizontal slide there, not
-            this route's vertical-dismiss gesture, since it's a drill-down on top of an
-            existing detail screen). A function `options` prop computing this per
-            `route.params` was tried first and didn't visibly change the animation
-            on-device — see `app/sermon/related/[id].tsx`'s own doc comment for why a
-            second static route replaced it. */}
+        {/* W4.1 — sermon detail draws its own header (`CastCloseHeader`), so the native
+            Stack header is fully disabled rather than just given an empty title.
+            `gestureDirection: 'vertical'` + `fullScreenGestureEnabled` give pull-down-to-
+            dismiss through `react-native-screens`' native transition: the previous screen
+            shows through while dragging, the drag tracks the finger exactly, and a released
+            drag springs back with real velocity. A hand-rolled `Animated` version gets all
+            three wrong (the ScrollView's rubber-band fights the wrapper's transform, touches
+            on the hero produce no drag, and the exit is a fixed-duration tween).
+            `animationDuration` is one static value for both push and pop: overriding it per
+            direction through `navigation.setOptions` does not take effect for this custom
+            animation + vertical gesture combination (see `detailTransition.ts`).
+            A tapped Related item pushes `sermon/related/[id]` instead: the same screen
+            component on a second route with the regular horizontal slide, since it is a
+            drill-down on top of a detail screen. A function `options` prop computed from
+            `route.params` does not change the animation on device, hence the separate
+            static route (see `app/sermon/related/[id].tsx`). */}
@@ line 114
-        {/* A *third* copy of the same screen, identically configured to the one above —
-            Isaac's follow-up ask, same session: tapping Related again from within
-            `sermon/related/[id]` pushed that same route name onto itself, and
-            `react-native-screens` didn't animate a push when the top two stack entries'
-            route *names* repeat (even though expo-router's own `router.push` always
+        {/* A *third* copy of the same screen, identically configured to the one above.
+            Tapping Related from within `sermon/related/[id]` would push that same route
+            name onto itself, and `react-native-screens` doesn't animate a push when the top
+            two stack entries' route *names* repeat (even though expo-router's own `router.push` always
@@ line 125
-        {/* Search tab removed (Isaac's ask, session 2026-10-02): Browse is now the sole
-            search entry point, pushing here rather than switching tabs. Owns its own header
+        {/* Browse is the search entry point and pushes here. Owns its own header
@@ line 129
-            (Isaac's follow-up ask, same session) means tapping Browse's search bar swaps
+            means tapping Browse's search bar swaps
@@ line 134
-            `series.tsx`'s own phone header (Isaac's ask, session 2026-10-02: "same
-            navigation style as all series page") — the native Stack header (which on iOS
+            `series.tsx`'s own phone header — the native Stack header (which on iOS
@@ line 139
-        {/* Session 2026-10-11 (Isaac's report: "use preestablish navigation style") — this
-            had no `options` at all, so it fell through to the Stack's own default native
-            header (title text + "< Browse" back label) instead of the bare-chevron +
-            centered-title pattern every other drill-down screen here uses. Now matches
-            `category/[id]` above. */}
+        {/* Bare-chevron + centered-title header like every other drill-down here; without
+            this entry the Stack's default native header (title + "< Browse" label) shows. */}
@@ line 147
-            this is the only transition between picking a sermon and hearing it (Nii's ask,
-            2026-10-23: previously sermon detail slid up, then replaced itself with this).
+            this is the only transition between picking a sermon and hearing it.
@@ line 180
-        {/* Session 2026-10-10 — the Library tab's playlist detail screen, reached from
+        {/* The Library tab's playlist detail screen, reached from
@@ line 187
-        {/* "Give your playlist a name" -> Create (Isaac's screenshots) — a genuine modal
+        {/* "Give your playlist a name" -> Create — a genuine modal
@@ line 193
-        {/* Session 2026-10-11 — Home's bell icon opens this instead of Announcements
-            (`HomeHeader`). Owns its own header (back chevron + centered
-            title), same "native Stack header disabled" pattern `category/[id]` and
-            `series.tsx`'s own phone header established — missing this entry here (Isaac's
-            report, same session: "Use previously established style for navigation page")
-            left the native default header showing on top of this screen's own custom one. */}
+        {/* Home's bell icon opens this (`HomeHeader`). Owns its own header (back chevron +
+            centered title), same "native Stack header disabled" pattern as `category/[id]`;
+            without this entry the native default header shows on top of the screen's own. */}
@@ line 202
-            pattern `category/[id]`/`speaker/[id]`/`notifications` established (Isaac's
-            report, session 2026-10-16: "use preestablish navigation style" — this had no
-            `options` at all, same gap `speaker/[id]` had session 2026-10-11). */}
+            pattern as `category/[id]`/`speaker/[id]`/`notifications`. */}
```

## `app/_notifications/SignatureNotifications.tsx`

```diff
@@ line 106
- * "Earlier" as plain rows. The featured release card is gone; the newest release simply
- * leads the New list.
+ * "Earlier" as plain rows. The newest release simply leads the New list.
@@ line 109
- * Notifications, Signature redesign (Nii's approved mockup "RhemaPod — Signature",
- * 2026-10-21), behind `SIGNATURE_NOTIFICATIONS_ENABLED`. Same data and read/unread
- * tracking as the classic screen — `useNewReleases()` with `useNotificationsBadge()` —
- * laid out as the newest release featured at the top, then "New" (the rest of its first
- * week) and "Earlier". A gold flame marks an unread row; opening a sermon marks it read,
- * and "Mark all read" clears everything listed.
+ * Behind `SIGNATURE_NOTIFICATIONS_ENABLED`. Same data and read/unread tracking as the
+ * classic screen — `useNewReleases()` with `useNotificationsBadge()`. Opening a sermon
+ * marks it read, and "Mark all read" clears everything listed.
@@ line 141
-        {/* Back sits on the title's row (Nii, 2026-11-11). */}
+        {/* Back sits on the title's row. */}
```

## `app/_search/SearchRow.tsx`

```diff
@@ line 10
-      information a sighted row used to show (a sermon's duration/speaker, a series'
+      information a richer row would show (a sermon's duration/speaker, a series'
@@ line 18
- * One plain text row with a hairline divider — the single row style Search now uses for
- * everything on the screen (Isaac's ask, session 2026-10-02 — Prime Video reference: a
- * flat list of titles, no thumbnails/avatars/icons), replacing `SuggestionRow`'s own
- * "↗ storm" treatment for live suggestions AND the richer `SermonResultRow`/
- * `SeriesListCard`/`SpeakerListRow` this screen's actual results used to render. Those
- * three keep their richer look everywhere else they're still used (category/speaker
- * drill-down, the all-series page, Browse) — only Search itself went flat.
+ * One plain text row with a hairline divider: a flat list of titles, no
+ * thumbnails/avatars/icons. Search uses it for live suggestions.
```

## `app/blocked-users.tsx`

```diff
@@ line 16
- * Bare-chevron + centered-title header (Isaac's ask, session 2026-10-16: "use
- * preestablish navigation style") — same layout `category/[id]`/`speaker/[id]`/
- * `notifications` already use, in place of the native Stack header this screen fell
- * through to before (`app/_layout.tsx` disables it for this route for the same reason).
+ * Bare-chevron + centered-title header — same layout `category/[id]`/`speaker/[id]`/
+ * `notifications` use (`app/_layout.tsx` disables the native Stack header for this route).
@@ line 43
-        {/* Back sits on the title's row (Nii, 2026-11-11). */}
+        {/* Back sits on the title's row. */}
```

## `app/category/[id].tsx`

```diff
@@ line 26
- * Renders a 2-column grid of `SermonCard` (Isaac's ask, session 2026-10-02: "follow the
- * same style as all series page") rather than the text-row `SermonResultRow` the Search
- * tab uses — `SermonCard` is the card used elsewhere for "same visual language as
+ * Renders a 2-column grid of `SermonCard` (the all-series page's card style) — `SermonCard` is the card used elsewhere for "same visual language as
@@ line 33
- * card's speaker-name line (Isaac's follow-up ask, same session) — the accessibility
+ * card's speaker-name line — the accessibility
@@ line 42
- * as you scroll (it used to stop at the first 20 while the header counted them all), so
- * long topics stay smooth: cards off screen are recycled rather than all kept mounted.
+ * as you scroll, so long topics stay smooth: cards off screen are recycled rather than all kept mounted.
@@ line 46
- * Earlier: custom back-chevron + centered-title header (Isaac's ask, same session: "same
- * navigation style as all series page") — same layout `series.tsx`'s own phone header
- * uses, in place of the native Stack header (`app/_layout.tsx` disables it for this
- * route) which would otherwise show "< Browse" next to the chevron on iOS rather than a
- * bare chevron.
+ * The native Stack header is disabled for this route (`app/_layout.tsx`); on iOS it would
+ * show "< Browse" next to the chevron rather than a bare chevron.
```

## `app/delete-account.tsx`

```diff
@@ line 177
-      {/* Back sits on the title's row (Nii, 2026-11-11), with the step over the title. */}
+      {/* Back sits on the title's row, with the step over the title. */}
```

## `app/devotional/_flow/steps.tsx`

```diff
@@ line 195
-          spacing (Nii, 2026-11-12: the passage looked cramped and clipped). */}
+          spacing instead of looking cramped and clipped. */}
```

## `app/onboarding.tsx`

```diff
@@ line 31
- * First-launch onboarding (Isaac's mockups: a 3-slide swipeable carousel shown only the
- * very first time the app is opened — before sign-in, before any account is known).
+ * First-launch onboarding: a 3-slide swipeable carousel shown only the very first time
+ * the app is opened — before sign-in, before any account is known.
@@ line 38
- * copy or swapping in real photography later (replacing the current Isaac-provided
- * placeholder images) is a one-line edit to that data file, never a change here.
+ * copy or swapping the photography is a one-line edit to that data file, never a change here.
@@ line 58
- * EXPERIMENTAL (Isaac's ask, 2026-10-16: "put some effects on the onboarding images to
- * make it alive") — may be reverted. A slow, continuous "Ken Burns" zoom on every slide's
+ * A slow, continuous "Ken Burns" zoom on every slide's
@@ line 64
- * swiping or which slide is active — Isaac's explicit follow-up ask, same session: "do not
- * add transition effects" (an earlier pass here also had a scroll-tied image parallax and
- * a per-slide fade+rise-in on the text card, both removed for that reason).
+ * swiping or which slide is active (no scroll-tied parallax or per-slide fade-ins).
@@ line 70
- * Daybreak redesign (canvas A2): the photo now fills the top half with rounded lower
+ * Daybreak design (canvas A2): the photo fills the top half with rounded lower
@@ line 74
- *
- * Earlier (Nii's ask, 2026-10-23 — the copy vanished in light mode because the old
- * light card used the dark palette's pill colour as its fill while `AppText`'s theme-aware
- * `inverse` tone flipped to near-white): the photo now fills the whole page and the copy
- * sits on a dark gradient at its foot. Everything here is drawn from the dark palette
- * (`onArt`) on purpose — it is all on photography, so it looks the same in both themes.
```

## `app/player/[id].tsx`

```diff
@@ line 73
- * **Offline playback** (Isaac's ask, session 2026-10-08 — the sole playback surface for a
- * downloaded sermon now, replacing the Downloads tab's old standalone mini-player): when
+ * **Offline playback** (the only playback surface for a downloaded sermon): when
@@ line 83
- * L5). Download's own pill lived here too for a while (session 2026-10-08) but is gone
- * again (Isaac's ask, session 2026-10-09 — it duplicated sermon/series detail's own
- * pill directly above the comments panel with nothing distinguishing the two); starting
- * a download is sermon/series detail's job exclusively now, this screen only plays back
- * whatever's already downloaded (`useLocalPlayback`, above).
+ * L5). The classic layout has no Download pill (sermon/series detail start downloads);
+ * the Signature layout's title block has one (`NowPlayingDetails`).
@@ line 89
- * Layout (design spec comments-and-player §1, revised 2026-10-09 — no controls outside the
- * player): header, video with every control (scrub, time, speed, sleep, fullscreen, plus
+ * Layout (design spec comments-and-player §1 — no controls outside the player): header, video with every control (scrub, time, speed, sleep, fullscreen, plus
@@ line 95
- * **Queue** (Nii's review, 2026-11-14 — it used to work only inside a playlist): the
- * queue is app-wide now (`lib/playback/queue.ts`), not this screen's route params. Opening
+ * **Queue**: the queue is app-wide (`lib/playback/queue.ts`), not this screen's route
+ * params. Opening
@@ line 102
- * navigator), so the next sermon plays on this same screen with no navigation transition
- * (Isaac's ask, 2026-10-11). `PlayerContent` is `key={sermonId}`-ed so IT still remounts
+ * navigator), so the next sermon plays on this same screen with no navigation
+ * transition. `PlayerContent` is `key={sermonId}`-ed so IT still remounts
@@ line 109
- * comments, with a switch at the foot. A playlist opens on its queue (Isaac's ask,
- * 2026-10-11: "open another page with all playlist items"); a single sermon opens on its
- * comments, as before.
+ * comments, with a switch at the foot. A playlist opens on its queue; a single sermon
+ * opens on its comments.
@@ line 156
-  // A `ready` download plays from its own local file instead of streaming (Isaac's ask,
-  // session 2026-10-08: "watch or listen offline later" means an actual playback path,
-  // not just a file sitting on disk) — `useStream`'s signed-URL fetch is skipped
+  // A `ready` download plays from its own local file instead of streaming — `useStream`'s signed-URL fetch is skipped
@@ line 227
-  // S8/S9 review (finding B1/D11/D2): a cache hit may only ever happen once THIS mount has
+  // A cache hit may only ever happen once THIS mount has
@@ line 254
-  // detail page — every list in the app now opens the player directly (one transition,
-  // Nii's ask 2026-10-23), so this is the one place that sends those few elsewhere.
+  // detail page — every list in the app opens the player directly (one transition), so
+  // this is the one place that sends those few elsewhere.
@@ line 275
-            in the smaller space without any JS-driven resize. `behavior="height"` (fixed
-            2026-10-16, Isaac's report: the keyboard covered the comment input on Android) had
-            this screen double-handling the resize — the OS's own `adjustResize` shrink *and*
-            `KeyboardAvoidingView`'s own height adjustment stacked on top of it, measured off
-            `Keyboard`'s event frame rather than the window the OS had already resized, which
-            is what actually left the composer covered rather than pushed clear.
+            in the smaller space without any JS-driven resize. `behavior="height"` would
+            double-handle the resize — the OS's `adjustResize` shrink *and*
+            `KeyboardAvoidingView`'s height adjustment, measured off `Keyboard`'s event frame
+            rather than the already-resized window — and leave the composer covered.
@@ line 331
-        // queue moves to a different sermon, since `PlayerScreen` itself no longer
-        // navigates to do that (see `selectQueueItem`/`advanceToNext`'s own comment).
+        // queue moves to a different sermon, since `PlayerScreen` itself doesn't
+        // navigate to do that (see `selectQueueItem`/`advanceToNext`'s own comment).
@@ line 758
- * still on its overlay (Nii, 2026-10-22: "all player controls must be kept on player"), then
+ * on the video's overlay, then
```

## `app/player/__tests__/[id].test.tsx`

```diff
@@ line 49
-// left on this screen itself (session 2026-10-09 — see the screen's own doc comment).
+// left on this screen itself (see the screen's own doc comment).
@@ line 882
-describe('PlayerScreen — downloaded sermon with no connection (Nii, 2026-11-11)', () => {
+describe('PlayerScreen — downloaded sermon with no connection', () => {
```

## `app/player/_comments/CommentsPanel.tsx`

```diff
@@ line 300
-      {/* No `TouchableWithoutFeedback` wrapper here on purpose — it was tried (session
-          2026-10-08) to dismiss the keyboard on a background tap, but it installs its own
-          touch responder on this whole area, which wins the responder negotiation against
-          the FlatList below *before* the list's own scroll/pull-to-refresh gesture gets a
-          chance to claim the touch — it broke both. The FlatList's own
+      {/* No `TouchableWithoutFeedback` wrapper here on purpose: to dismiss the keyboard on
+          a background tap it would install its own touch responder on this whole area,
+          which wins the responder negotiation against the FlatList below *before* the
+          list's own scroll/pull-to-refresh gesture can claim the touch, breaking both. The FlatList's own
```

## `app/player/_comments/TermsSheet.tsx`

```diff
@@ line 12
-// by a blank line, then the body — split once so the title can render bold (the sheet's
-// own "Comment guidelines" label header was removed as redundant with it). Staff edit the
+// by a blank line, then the body — split once so the title can render bold (the sheet has
+// no separate label header, which would repeat it). Staff edit the
@@ line 32
- * `COMMENTS_TERMS_TEXT` (Isaac's input I2; see `lib/content/commentsCompliance.ts`) offline,
+ * `COMMENTS_TERMS_TEXT` (see `lib/content/commentsCompliance.ts`) offline,
```

## `app/player/_player/QueueList.tsx`

```diff
@@ line 41
- * whole queue in play order with the current item marked; tapping a row plays it. It was
- * first built for playlists only (Isaac's ask, session 2026-10-11) and since Nii's review
- * (2026-11-14) shows the app-wide queue, wherever playback started.
+ * whole app-wide queue in play order, wherever playback started, with the current item
+ * marked; tapping a row plays it.
```

## `app/player/_player/TransportControls.tsx`

```diff
@@ line 125
- * The bottom row of the video's own controls overlay (design spec §1.3, revised
- * 2026-10-08): scrubbable seek, elapsed / total, speed pill, sleep moon, native-fullscreen
+ * The bottom row of the video's own controls overlay (design spec §1.3): scrubbable seek, elapsed / total, speed pill, sleep moon, native-fullscreen
```

## `app/player/_player/VideoSurface.tsx`

```diff
@@ line 31
-   * `null`/`undefined` falls back to the plain dark surface, same as before this prop
-   * existed. */
+   * `null`/`undefined` falls back to the plain dark surface. */
@@ line 40
-  /** The rest of what used to be the separate below-player bar (design spec revision,
-   * Isaac's ask session 2026-10-08: no buttons outside the player — scrub, time, speed,
-   * sleep timer and fullscreen all move onto the video surface itself, in the same
-   * tap-to-toggle, auto-hiding overlay as play/pause/skip). */
+  /** The bottom control row (no buttons outside the player — scrub, time, speed, sleep
+   * timer and fullscreen sit on the video surface itself, in the same tap-to-toggle,
+   * auto-hiding overlay as play/pause/skip). */
@@ line 64
- * The video area (design spec comments-and-player §1.2, revised 2026-10-08): a 16:9 surface
+ * The video area (design spec comments-and-player §1.2): a 16:9 surface
@@ line 144
-        // show playback is active (Isaac's report). Rendered *over* `VideoView` (which
+        // show playback is active. Rendered *over* `VideoView` (which
```

## `app/player/_player/__tests__/VideoSurface.test.tsx`

```diff
@@ line 55
-describe("VideoSurface — audio artwork (Isaac's report: plain dark screen for audio)", () => {
+describe("VideoSurface — audio artwork (not a plain dark screen for audio)", () => {
```

## `app/player/_player/cyclePlaybackSpeed.ts`

```diff
@@ line 7
- * rather than declaring a second one here — Profile & Settings' own default-speed
- * picker is gone (session 2026-10-09, this control is the only remaining way to change
- * playback speed), but `defaultSpeed`/`PLAYBACK_SPEEDS` themselves stay the shared
- * source of truth regardless.
+ * rather than declaring a second one here. This control is the only way to change
+ * playback speed; `defaultSpeed`/`PLAYBACK_SPEEDS` stay the shared source of truth.
```

## `app/player/_signature/ListenPanel.tsx`

```diff
@@ line 125
-          their own, so the comments under the title keep their room (Nii's phone test,
-          2026-11-11: Listen cut the comments off). */}
+          their own, so the comments under the title keep their room. */}
```

## `app/player/_signature/NowPlayingDetails.tsx`

```diff
@@ line 19
- * Download is back on the player at Nii's ask (2026-10-21), as the detail page's own
- * `DownloadPillButton` in its compact skin; a finished download plays from the local file
+ * Download is the detail page's own `DownloadPillButton` in its compact skin; a finished download plays from the local file
@@ line 40
-        {/* A step smaller, at most two lines, with the speaker on one: the block felt
-            crowded at the full title size (Nii's phone test, 2026-11-12). */}
+        {/* A step smaller, at most two lines, with the speaker on one: the block reads
+            crowded at the full title size. */}
@@ line 139
-  // One line, never wrapping (Nii, 2026-10-22): the pills shrink and their labels truncate
+  // One line, never wrapping: the pills shrink and their labels truncate
```

## `app/player/_signature/PaneSwitch.tsx`

```diff
@@ line 18
- * still what opens first (Isaac's 2026-10-11 ask). Playback controls stay on the video.
+ * what opens first. Playback controls stay on the video.
```

## `app/player/_signature/PlayerBackdrop.tsx`

```diff
@@ line 32
- * The full player's background (Nii, 2026-11-15): the sermon's own art, heavily blurred,
+ * The full player's background: the sermon's own art, heavily blurred,
@@ line 38
- * No new native code: `expo-image`'s blur and `react-native-svg`, both already in the app.
+ * Built from `expo-image`'s blur and `react-native-svg`, no extra native code.
```

## `app/playlist/_detail/AddToPlaylistSheet.tsx`

```diff
@@ line 21
-   * and tapping that checkmark removes the item (Isaac's ask, session 2026-10-10: "users
-   * should be able to click on the checked icon to uncheck/remove item"), via `onRemove`
-   * below. A plain `Set<string>` of sermon ids isn't enough for that — removing a
+   * and tapping that checkmark removes the item via `onRemove` below. A plain `Set<string>` of sermon ids isn't enough for that — removing a
@@ line 38
- * "Add to Playlist" (Isaac's screenshots). Rebuilt session 2026-10-10 from a
- * single flat search list into the reference's own tabbed version:
- * Sermons / Episodes / Downloaded, each a real browsable default list (not
+ * "Add to Playlist", tabbed: Sermons / Episodes / Downloaded, each a real browsable default list (not
@@ line 49
- * shared read pages through every matching result via `useSearchResultsInfinite`
- * (Isaac's report, same session: "not all episodes are showing" — the plain
- * hook's implicit 20-result cap was shared across both tabs, so whichever one
- * sorted past it came up short; there's no server-side "episodes only" filter
- * to split the fetch on instead, so paging to completion is the real fix).
+ * shared read pages through every matching result via `useSearchResultsInfinite`:
+ * a single 20-result page would be shared across both tabs, so whichever one
+ * sorts past it comes up short, and there's no server-side "episodes only"
+ * filter to split the fetch on instead.
@@ line 58
- * The reference's fourth pill, "Recently played", is left out (Isaac's own
- * call when asked how to source it): this app has no endpoint returning
+ * There's no "Recently played" tab: this app has no endpoint returning
```

## `app/playlist/_detail/PlaylistCoverPicker.tsx`

```diff
@@ line 34
- * same shape `ProfileAvatarPicker` uses for the profile picture (session
- * 2026-10-09), square here instead of circular since a playlist cover is a
- * square tile everywhere it's shown (the Library tab's own `PlaylistCard`,
- * this header). No "Create cover art" collage generator (Isaac's call,
- * session 2026-10-10) — plain upload only, the same direct-to-storage
+ * same shape `ProfileAvatarPicker` uses for the profile picture, square here
+ * instead of circular since a playlist cover is a square tile everywhere it's
+ * shown (the Library tab's own `PlaylistCard`, this header). No collage
+ * generator — plain upload only, the same direct-to-storage
```

## `app/playlist/_detail/PlaylistDetailsSheet.tsx`

```diff
@@ line 25
- * "Name & details" (Isaac's screenshots: rename, description, Make private/
- * public, Delete playlist, all in one sheet) — the playlist-domain sibling of
+ * "Name & details" (rename, description, Make private/public, Delete playlist,
+ * all in one sheet) — the playlist-domain sibling of
```

## `app/playlist/_detail/PlaylistOptionsSheet.tsx`

```diff
@@ line 16
- * Playlist detail's "..." menu (Isaac's screenshots). Trimmed to the three
- * actions this app can genuinely back: Share (real, React Native's share
+ * Playlist detail's "..." menu: the three actions this app can genuinely back: Share (real, React Native's share
@@ line 19
- * and Name & details (rename/description/privacy/delete). The reference
- * sheet's "Download", "Create cover art", "Switch to video", and "Exclude
- * playlist from taste profile" rows are left out — no bulk-download-a-
- * playlist pipeline, no cover-art generator, no audio/video switch, and no
- * recommendation algorithm exist anywhere in this app to back them; a menu
- * row that does nothing is worse than one that isn't there (the same call
+ * and Name & details (rename/description/privacy/delete). No "Download",
+ * "Create cover art", "Switch to video" or "Exclude from taste profile" rows:
+ * nothing in this app backs them, and a menu row that does nothing is worse
+ * than one that isn't there (the same call
@@ line 30
-  // Closing this sheet and mounting another `<Modal>` in the same tick (React 18
-  // batches `onClose()` + the next sheet's `setXOpen(true)` together) presents two
-  // native modals at once and reliably hangs iOS (RN's own Modal can't dismiss and
-  // present back-to-back without a gap). Isaac's report, session 2026-10-10: tapping
-  // "Add to this playlist" or "Name & details" from this menu froze the screen — both
-  // open another `Sheet`; "Share" never did, since it opens the OS share sheet, a
-  // different native primitive, not an RN Modal.
+  // Closing this sheet and mounting another `<Modal>` in the same tick (React batches
+  // `onClose()` + the next sheet's `setXOpen(true)` together) presents two native modals
+  // at once and reliably hangs iOS (RN's own Modal can't dismiss and present
+  // back-to-back without a gap). "Add to this playlist" and "Name & details" both open
+  // another `Sheet`; "Share" opens the OS share sheet, a different native primitive.
@@ line 38
-  // A fixed delay before firing the next action was tried first and *didn't* reliably
-  // fix it (Isaac's follow-up, same session: "options-menu freeze is not fixed") — a
-  // guessed timeout races the real native dismiss instead of waiting for it. This
-  // version holds the action until `Sheet`'s own `onDismiss` confirms the native modal
+  // A fixed delay is not enough — a guessed timeout races the real native dismiss
+  // instead of waiting for it. So the action is held until `Sheet`'s own `onDismiss` confirms the native modal
```

## `app/playlist/_detail/SermonAddRow.tsx`

```diff
@@ line 12
- * own Downloaded tab, Isaac's ask, session 2026-10-10), without needing to fake
+ * own Downloaded tab), without needing to fake
@@ line 31
-  /** This sermon is on-device (`AddToPlaylistSheet`'s Sermons/Episodes tabs,
-   * Isaac's ask, session 2026-10-10) — a small sage checkmark next to the
+  /** This sermon is on-device (`AddToPlaylistSheet`'s Sermons/Episodes tabs) — a small sage checkmark next to the
@@ line 40
-   * being a dead end (Isaac's ask, session 2026-10-10: "users should be able
-   * to click on the checked icon to uncheck/remove item"). Optional — the
+   * being a dead end. Optional — the
@@ line 51
- * search results and `[id].tsx`'s own "Recommended sermons" list (Isaac's ask, session
- * 2026-10-10), same row shape both places rather than two near-identical copies.
+ * search results and `[id].tsx`'s own "Recommended sermons" list, same row shape both places rather than two near-identical copies.
@@ line 54
- * The add button is a thin-outline circle (not filled) — a filled gold chip (the first
- * version of this row) read as "too fancy" (Isaac's follow-up, same session); the
+ * The add button is a thin-outline circle (not filled, which reads as too loud); the
@@ line 59
- * No inline preview on this thumbnail — tried once (session 2026-10-10), reverted the
- * next session (Isaac's own call): preview is a playlist-item affordance
+ * No inline preview on this thumbnail: preview is a playlist-item affordance
```

## `app/playlist/_detail/__tests__/AddToPlaylistSheet.test.tsx`

```diff
@@ line 157
-  it('Downloaded tab renders the local thumbnailPath over the presigned thumbnailUrl when both are present, and falls back to thumbnailUrl when there is no local copy yet (session 2026-10-15 thumbnail fix)', async () => {
+  it('Downloaded tab renders the local thumbnailPath over the presigned thumbnailUrl when both are present, and falls back to thumbnailUrl when there is no local copy yet', async () => {
```

## `app/playlist/_detail/__tests__/SignatureAddToPlaylistSheet.test.tsx`

```diff
@@ line 157
-  it('Downloaded tab renders the local thumbnailPath over the presigned thumbnailUrl when both are present, and falls back to thumbnailUrl when there is no local copy yet (session 2026-10-15 thumbnail fix)', async () => {
+  it('Downloaded tab renders the local thumbnailPath over the presigned thumbnailUrl when both are present, and falls back to thumbnailUrl when there is no local copy yet', async () => {
```

## `app/playlist/_detail/__tests__/usePlaylistPreview.test.ts`

```diff
@@ line 36
-    // Simulates the real crash (Isaac's report, session 2026-10-11): on some
+    // Simulates a real crash: on some
```

## `app/playlist/_detail/playlistQueue.ts`

```diff
@@ line 12
- * Starts the app-wide queue on a playlist (Isaac's ask, session 2026-10-10: Play/Shuffle at
- * the top of a playlist should play through it), from `startIndex` in `order` — the saved
+ * Starts the app-wide queue on a playlist (Play/Shuffle at the top of a playlist play
+ * through it), from `startIndex` in `order` — the saved
```

## `app/playlist/_detail/sermonMeta.ts`

```diff
@@ line 8
- * sermon, or `null` for neither. Shared by `SermonAddRow` and `PlaylistItemRow` (Isaac's
- * ask, session 2026-10-10: playlist items should show "category|episode/sermon" instead
- * of speaker + duration — the exact same category-or-episode line `SermonAddRow` already
- * computes, promoted here once a second row type needed it). */
+ * sermon, or `null` for neither. Shared by `SermonAddRow` and `PlaylistItemRow`, which
+ * show this line instead of speaker + duration. */
```

## `app/playlist/_detail/signature/SignaturePlaylistDetail.tsx`

```diff
@@ line 219
-            // A plain Pressable: PressableScale styles its inner view, so `flex: 1` never
-            // reached the row and the pill collapsed to a circle (Nii's phone test).
+            // A plain Pressable: PressableScale styles its inner view, so `flex: 1` would
+            // never reach the row and the pill would collapse to a circle.
```

## `app/playlist/_detail/signature/SignatureSermonRows.tsx`

```diff
@@ line 62
-  // Category or series/episode only — no speaker or duration (Isaac's ask, 2026-10-10).
+  // Category or series/episode only — no speaker or duration.
```

## `app/playlist/_detail/usePlaylistPreview.ts`

```diff
@@ line 8
- * play/pause icon (Isaac's ask, session 2026-10-10: "play and pause video without
- * fully opening the player page" — scoped down, by Isaac's own choice when asked,
- * to a sound-only preview: no video surface is rendered anywhere in a 48px
- * thumbnail, and only one row previews at a time).
+ * play/pause icon: a sound-only preview without opening the player (no video
+ * surface in a 48px thumbnail), and only one row previews at a time.
@@ line 45
-  // The real bug (Isaac's report, session 2026-10-11: "pressing play is not playing
-  // audio") — an inline callback here is a NEW function identity on every render,
+  // Must be `useCallback`-stable: an inline callback here is a NEW function identity on
+  // every render,
@@ line 51
-  // clearing it again before the sound ever had a chance to play. React Navigation's
-  // own docs call this out: the callback must be `useCallback`-stable, or this exact
-  // thing happens. `[player]` is a safe, never-changing dependency — one stable
+  // clearing it again before the sound ever had a chance to play (React Navigation's
+  // docs call this out). `[player]` is a safe, never-changing dependency — one stable
@@ line 58
-        // Back-navigation crash (Isaac's report, session 2026-10-11: "Render Error" —
-        // FunctionCallException / NativeSharedObjectNotFoundException at this exact
-        // line). On some unmounts, `useVideoPlayer`'s own native object has already
+        // Guards a back-navigation crash (FunctionCallException /
+        // NativeSharedObjectNotFoundException here). On some unmounts, `useVideoPlayer`'s own native object has already
```

## `app/playlist/create.tsx`

```diff
@@ line 23
- * "Give your playlist a name" -> Create (Isaac's screenshots), a full-screen
- * modal registered with `presentation: 'modal'` in `_layout.tsx` — the
- * reference's own dark full-bleed takeover, not a bottom sheet. The
- * suggested default name counts the caller's existing playlists, same
- * "My Playlist #N" convention Spotify's own screenshot shows. On success,
+ * "Give your playlist a name" -> Create, a full-screen modal registered with
+ * `presentation: 'modal'` in `_layout.tsx`, not a bottom sheet. The
+ * suggested default name counts the caller's existing playlists
+ * ("My Playlist #N"). On success,
```

## `app/search.tsx`

```diff
@@ line 41
- *
- * This brings back the headings and thumbnails that an earlier flat-list pass took out
- * (Isaac, 2026-10-02), because the Daybreak mockup Nii approved has them.
@@ line 63
-  // in a result group (Isaac's ask, session 2026-10-02 — the suggest endpoint can return
-  // a phrase that's also an exact sermon/series/speaker title, which read as an outright
-  // duplicate once suggestions and results became visually identical flat rows).
+  // in a result group (the suggest endpoint can return a phrase that's also an exact
+  // sermon/series/speaker title, which would read as a duplicate).
@@ line 113
-          // Isaac's ask, session 2026-10-02: the field is ready to type into the
-          // instant the screen opens, no extra tap to focus it first.
+          // The field is ready to type into the instant the screen opens, no extra
+          // tap to focus it first.
@@ line 180
-              // live suggestions but zero matches showed both at once (Isaac's report).
+              // live suggestions but zero matches would show both at once.
```

## `app/series/_detail/DetailTabs.tsx`

```diff
@@ line 23
- * Episodes/Related tab switcher (Isaac's ask, session 2026-09-30) — just these two.
- * Netflix's own reference also has "Collection" and "Trailers" tabs, but this app has
- * no data for either (no trailer renditions, no series-collection concept) — a tab
- * that opens onto nothing is worse than no tab, same call this screen's original build
- * already made for those two.
+ * Episodes/Related tab switcher — just these two. There are no "Collection" or
+ * "Trailers" tabs: this app has no data for either, and a tab that opens onto nothing
+ * is worse than no tab.
```

## `app/series/_detail/Skeleton.tsx`

```diff
@@ line 16
-      {/* Matches the real hero's 4:3 ratio (Isaac's ask, session 2026-09-30: a bigger
-          banner) at a representative phone width — not measured live, just a closer
-          placeholder than the old 16:9-sized block was. */}
+      {/* Matches the real hero's 4:3 ratio at a representative phone width — not
+          measured live, just a close placeholder. */}
```

## `app/series/_detail/cta.ts`

```diff
@@ line 19
- * Series-detail's Play/Resume CTA (Isaac's ask, session 2026-09-30 — Netflix's title-page
- * Play button, which always targets a specific episode, never the series itself) — the
+ * Series-detail's Play/Resume CTA, which always targets a specific episode, never the
+ * series itself — the
```

## `app/series/_detail/useSeriesScreen.ts`

```diff
@@ line 36
-  // Close (the X) dismisses the whole stack — "close all pages" (Isaac's ask, session
-  // 2026-10-01), however many Related/episode drill-down levels deep the user is —
+  // Close (the X) dismisses the whole stack, however many Related/episode drill-down levels deep the user is —
@@ line 42
-  // Episodes open the player directly — one transition from the tap to playback (Nii's
-  // ask, 2026-10-23). A locked or not-yet-ready episode is handed on to its detail page
+  // Episodes open the player directly — one transition from the tap to playback. A locked or not-yet-ready episode is handed on to its detail page
@@ line 84
-  // Downloads whichever rendition each episode actually has (Isaac's ask, session
-  // 2026-10-08: "download based on the media type available for each episode") — an
-  // episode with no rendition at all yet is skipped, not retried as a failure.
+  // Downloads whichever rendition each episode actually has — an episode with no
+  // rendition at all yet is skipped, not retried as a failure.
@@ line 111
-  // the series is still missing would be misleading. Toggling off (Isaac's ask, session
-  // 2026-10-11: "allow user toggle") removes every episode, since by definition all of
+  // the series is still missing would be misleading. Toggling off removes every episode, since by definition all of
```

## `app/series/_signature/SignatureSeries.tsx`

```diff
@@ line 20
-// Full-bleed cover, running up under the status bar (Nii's edit to the mockup: a bigger
-// top image than the classic page's inset 4:3 banner).
+// Full-bleed cover, running up under the status bar (bigger than the classic page's
+// inset 4:3 banner).
@@ line 31
- * Series detail in the Signature redesign (mockup "RhemaPod — Signature", series page),
- * behind `EXPO_PUBLIC_SIGNATURE_SERIES`. Same data and actions as the classic screen —
+ * Series detail in the Signature design, behind `EXPO_PUBLIC_SIGNATURE_SERIES`. Same data and actions as the classic screen —
@@ line 36
- * Episodes and Related tabs. No comments block (Nii's edit). Every colour comes from the
+ * Episodes and Related tabs. No comments block. Every colour comes from the
```

## `app/sermon/[id].tsx`

```diff
@@ line 27
- * the staff-only `GET /api/v1/sermons/{sermon_id}` the original task brief named (§8.0's
- * own correction). Resume detection is the Conductor's decision (W4.1): call
- * `GET /sermons/{sermon_id}/progress` directly rather than the addendum's originally-bound
- * `/me/continue-watching` (bounded to the 10 most-recent plays) — see
+ * the staff-only `GET /api/v1/sermons/{sermon_id}` (§8.0). Resume detection calls
+ * `GET /sermons/{sermon_id}/progress` directly rather than `/me/continue-watching`
+ * (bounded to the 10 most-recent plays) — see
@@ line 49
-  // Signature player (Nii, 2026-10-22: "when a single or standalone sermon is selected, open
-  // player screen directly", then "when a single episode is selected open the player
-  // directly"): any playable sermon, a series episode included, skips this page and opens
+  // Signature player: any playable sermon, a series episode included, skips this page and opens
@@ line 64
-  // Close (the X) dismisses the whole stack — "close all pages" (Isaac's ask, session
-  // 2026-10-01), however many Related/episode drill-down levels deep the user is —
+  // Close (the X) dismisses the whole stack, however many Related/episode drill-down levels deep the user is —
@@ line 68
-  // Drill-down entry (Isaac's ask, session 2026-10-01): a Related item pushed this
+  // Drill-down entry: a Related item pushed this
@@ line 256
-  // Left-aligned with fixed gaps, not edge-to-edge `space-between` — matches Isaac's
-  // own Netflix reference screenshot, session 2026-10-01. Gap widened past the token
-  // scale's own max (`spacing.xxl`) per Isaac's own follow-up ask, same session.
+  // Left-aligned with fixed gaps, not edge-to-edge `space-between`. The gap is deliberately
+  // wider than the token scale's own max (`spacing.xxl`).
@@ line 276
-  // Bold text + gold underline strip (Isaac's ask, session 2026-10-01, matching
-  // `DetailTabs`' own selected-tab treatment on series detail) — a static section
+  // Bold text + gold underline strip (matching `DetailTabs`' own selected-tab treatment on series detail) — a static section
```

## `app/sermon/_detail/cta.ts`

```diff
@@ line 20
- * CTA label/state per design spec §8.4, using the Conductor's decision (W4.1) to resolve
- * Fresh-vs-Resume off `GET /sermons/{id}/progress` directly rather than the addendum's
- * originally-bound, bounded `/me/continue-watching` list (see `useSermonProgress.ts`'s
+ * CTA label/state per design spec §8.4, resolving Fresh-vs-Resume off
+ * `GET /sermons/{id}/progress` directly rather than the bounded `/me/continue-watching` list (see `useSermonProgress.ts`'s
@@ line 25
- * "Fresh" also covers a `completed: true` progress row — the addendum (§8.4) only ever
- * defines Fresh vs. Resume off the old bounded list, which by construction never returns
- * a completed sermon; a fully-watched sermon has nothing left to resume, so it collapses
- * to Fresh (full duration, Play/Listen) the same as "never played". This is a small,
- * necessary extrapolation of the addendum's own definition onto the new data source, not
- * a new product decision — flagged here, not silently assumed.
+ * "Fresh" also covers a `completed: true` progress row: a fully-watched sermon has nothing
+ * left to resume, so it shows as Fresh (full duration, Play/Listen) the same as "never
+ * played". (The addendum, §8.4, defines Fresh vs. Resume only for the continue-watching
+ * list, which never returns a completed sermon.)
```

## `app/sermon/_detail/isPlayable.ts`

```diff
@@ line 9
- * Two conditions collapse into this single check, per the Conductor's interim decision
- * (W4.1, pending Isaac's sign-off, recorded in status.md): `media_refs = []` (Stream
+ * Two conditions collapse into this single check (W4.1): `media_refs = []` (Stream
```

## `app/sermon/_detail/meta.ts`

```diff
@@ line 5
- * The single meta line under the title (Isaac's ask, session 2026-10-01: published
- * date, category, and tier on one line — replacing the previous two-line
- * placement/duration/format + published/renditions pair; the date itself trimmed to just
- * the year, no "published" keyword, later the same session). Tier itself renders as the
+ * The single meta line under the title: published year (no "published" keyword),
+ * category, and tier on one line. Tier itself renders as the
```

## `app/sermon/related/[id].tsx`

```diff
@@ line 2
- * Same screen as `sermon/[id]`, registered under a second route path (Isaac's ask,
- * session 2026-10-01: tapping a Related item should push with the regular horizontal
- * slide, not the vertical-dismiss gesture every other entry point uses).
+ * Same screen as `sermon/[id]`, registered under a second route path so tapping a Related
+ * item pushes with the regular horizontal slide, not the vertical-dismiss gesture every
+ * other entry point uses.
@@ line 7
- * `gestureDirection`, `animationDuration`) are static per route in practice — an
- * earlier attempt at a *function* `options` prop computing them from `route.params`
- * (reading a `related` param) type-checked and unit-tested fine, but Isaac reported no
- * visible animation change on-device, meaning the native side isn't reliably picking up
- * a per-push variation that way. A second, differently-configured route is the one
- * mechanism proven reliable all session for this kind of thing: each route's
- * `Stack.Screen` options in `app/_layout.tsx` are a plain static object, read once.
+ * `gestureDirection`, `animationDuration`) are static per route in practice: a *function*
+ * `options` prop computing them from `route.params` type-checks and unit-tests fine but
+ * makes no visible difference on device. A second, differently-configured route is
+ * reliable: each route's `Stack.Screen` options in `app/_layout.tsx` are a plain static
+ * object, read once.
```

## `app/sermon/related2/[id].tsx`

```diff
@@ line 2
- * A second copy of `sermon/related/[id]` (same screen, same `Stack.Screen` options) —
- * Isaac's follow-up ask, session 2026-10-01: tapping Related from *within* a Related
- * screen pushed `sermon/related/[id]` on top of itself (same route name twice in a
- * row), and the animation stopped showing from that second level on, even though
+ * A second copy of `sermon/related/[id]` (same screen, same `Stack.Screen` options).
+ * Tapping Related from *within* a Related screen would push `sermon/related/[id]` on top
+ * of itself (same route name twice in a row), and the push doesn't animate from that
+ * second level on, even though
```

## `app/speaker/[id].tsx`

```diff
@@ line 30
- * result. Custom back-chevron + centered-title header, native Stack header disabled
- * (Isaac's ask, session 2026-10-11: "use preestablish navigation style") — this screen
- * had been left on the Stack's own default native header this whole time
- * (`app/_layout.tsx` carried no `options` for this route at all); now the same
- * bare-chevron pattern `category/[id].tsx`/`series.tsx`'s own phone header established.
+ * result. Custom back-chevron + centered-title header, native Stack header disabled —
+ * the same bare-chevron pattern as `category/[id].tsx`/`series.tsx`'s phone header.
@@ line 36
- * Reorganized (same ask: "organise it better") around a real info header — an `Avatar`
- * initials chip (no speaker-photo field exists on `SpeakerPublic`, same fallback this
- * app already uses everywhere else a person has no photo on file), name, sermon count,
- * and bio — instead of bare stacked text with nothing to anchor it. Sermons render as a
- * `SermonCard` grid now, not the old text-only `SermonResultRow` (deleted — this was its
- * one remaining call site) — `category/[id].tsx`'s own established grid, so the app's
- * two "drill down from Browse" screens read as siblings instead of two different eras
- * of design. `showMeta={false}` on each card for the same reason `category/[id].tsx`
+ * Built around an info header — an `Avatar` initials chip (no speaker-photo field exists
+ * on `SpeakerPublic`, same fallback this app uses everywhere else a person has no photo
+ * on file), name, sermon count, and bio. `showMeta={false}` on each card for the same reason `category/[id].tsx`
@@ line 49
- * filtered on `speaker_id`, paged 50 at a time into a `FlashList` as you scroll (it used
- * to stop at the first 20).
+ * filtered on `speaker_id`, paged 50 at a time into a `FlashList` as you scroll.
```

## `components/ActionButton.tsx`

```diff
@@ line 16
-  /** A notification-style count badge pinned to the icon's top-right corner (Isaac's ask,
-   * session 2026-10-09 — Like's own counter, not a second label line). Renders nothing
+  /** A notification-style count badge pinned to the icon's top-right corner (Like's own
+   * counter, not a second label line). Renders nothing
@@ line 23
- * Icon-over-label action button — series detail's action row (Isaac's ask, session
- * 2026-09-30, Netflix's title-page "Set Reminders / My List / Rate / Share" row);
- * promoted here once sermon detail became its second consumer (session 2026-10-01,
- * which also added a third action, Like, alongside My List and Share; series detail
- * later added a fourth, Download — see `app/series/[id].tsx`'s own call site for what
- * it does). My List was a client-only toggle at first (Isaac's own call at the time:
- * "will be used for adding to playlist later") — it's real now (session 2026-10-11),
- * via `useAddToDefaultLibrary` (`usePlaylists.ts`'s own doc comment on the "default
+ * Icon-over-label action button — the action row on sermon detail (My List, Like, Share)
+ * and series detail (plus Download — see `app/series/[id].tsx`'s own call site). My List
+ * goes through `useAddToDefaultLibrary` (`usePlaylists.ts`'s own doc comment on the "default
@@ line 39
- * Icon size (28) matched to Isaac's own Netflix reference screenshot, session
- * 2026-10-01; the row itself (each screen's own `actionRow` style, not this
- * component's) is left-aligned with fixed gaps for 3 items, `space-between` once
- * Download made it 4 — see series detail's own `actionRow` style for why. Label
- * started on `ui.body` (regular, 14), was trimmed to a plain smaller size (12, still
- * regular weight), then — Isaac's follow-up, same session, "reduce it further and bold
- * it" — moved to the dedicated `ui.actionLabel` variant (bold, 11): per `Text.tsx`'s own
- * rule ("never override `fontFamily` at a call site — add a new variant instead"), a
- * bold weight needs a real variant, not a style-prop override. "Bold icon text" meant
- * the literal label text specifically (Isaac's own clarification, same session) — the
- * icon glyphs themselves (`add`/`checkmark`, `heart`/`heart-outline`, `share-outline`,
- * `download-outline`) are unchanged; a same-session detour through solid `share`/
- * `download` glyphs was reverted.
+ * Icon size 28. The row itself (each screen's own `actionRow` style, not this
+ * component's) is left-aligned with fixed gaps for 3 items, `space-between` for 4 — see
+ * series detail's own `actionRow` style for why. The label uses the dedicated
+ * `ui.actionLabel` variant (bold, 11): per `Text.tsx`'s own rule ("never override
+ * `fontFamily` at a call site — add a new variant instead"), a bold weight needs a real
+ * variant, not a style-prop override. Only the label is bold; the icon glyphs are the
+ * outline set (`add`/`checkmark`, `heart`/`heart-outline`, `share-outline`,
+ * `download-outline`).
@@ line 53
- * `badgeCount` (session 2026-10-09, Like's own real counter): a small gold
- * notification-style badge pinned to the icon's own top-right corner, not a second
- * label line — Isaac's explicit call after an initial "Like\n{N}" two-line label read
- * as "old fashioned". Pops in (`PopIn`) on mount, re-keyed per count so a plain
+ * `badgeCount` (Like's counter): a small gold notification-style badge pinned to the
+ * icon's own top-right corner, not a second label line. Pops in (`PopIn`) on mount, re-keyed per count so a plain
@@ line 155
-  // "Download\n{N} Episodes", series detail, session 2026-10-01) — harmless no-op for
+  // "Download\n{N} Episodes", series detail) — harmless no-op for
```

## `components/Avatar.tsx`

```diff
@@ line 13
-  /** A real profile picture (session 2026-10-09) — renders instead of the initials
-   * chip when present. `null`/`undefined` keeps the original initials-only
-   * behavior; every existing call site is unaffected by this addition. */
+  /** A real profile picture — renders instead of the initials chip when present.
+   * `null`/`undefined` shows the initials. */
@@ line 58
-  // own curve, reading as "touching the edge" (Isaac's ask, session 2026-10-10) rather
-  // than comfortably centered. Scaling down (never up) keeps every existing 38-40px
-  // avatar pixel-identical while giving a small one real breathing room.
+  // own curve, reading as "touching the edge" rather than comfortably centered. Scaling
+  // down (never up) leaves the usual 38-40px avatar as is while giving a small one real
+  // breathing room.
```

## `components/Button.tsx`

```diff
@@ line 12
-  /** Leading glyph — series detail's Play CTA (Isaac's ask, session 2026-09-30,
-      Netflix's own Play button) is this prop's first user. */
+  /** Leading glyph — e.g. series detail's Play CTA. */
```

## `components/CastCloseHeader.tsx`

```diff
@@ line 13
-  /** Drill-down entry only (Isaac's ask, session 2026-10-01 — tapping a Related item
-      pushes a *new* detail screen on top of the current one, standard right-to-left,
-      rather than presenting fresh with the vertical-dismiss gesture): a back chevron at
-      top-left, alongside Cast/Close at top-right, matching Isaac's own reference
-      screenshot. Omitted (the default) for every other way of reaching this screen —
-      no chevron renders at all, same as before this existed. */
+  /** Drill-down entry only (tapping a Related item pushes a *new* detail screen on top of
+      the current one, standard right-to-left, rather than presenting fresh with the
+      vertical-dismiss gesture): a back chevron at top-left, alongside Cast/Close at
+      top-right. Omitted (the default) for every other way of reaching this screen — no
+      chevron renders at all. */
@@ line 27
- * Cast+Close chrome for a title-page-style detail screen (Isaac's ask, session
- * 2026-09-30, series detail; promoted to shared, session 2026-10-01, sermon detail
- * became its second consumer) — Prime Video/Netflix's own title-page chrome, replacing
- * the plain back-chevron `DetailHeader` on screens built with a full-bleed hero banner.
+ * Cast+Close chrome for a title-page-style detail screen with a full-bleed hero banner
+ * (series and sermon detail).
@@ line 33
- * series detail — Nii's ask, 2026-10-22) and the build has the Cast SDK; everywhere else
+ * series detail) and the build has the Cast SDK; everywhere else
@@ line 37
- * Absolutely positioned over the hero (same reasoning `DetailHeader`'s iOS variant
- * already uses) — takes no layout space, so the hero renders at its full size
+ * Absolutely positioned over the hero — takes no layout space, so the hero renders at its full size
@@ line 41
- * Each icon sits on its own translucent circular chip (Isaac's ask, session 2026-10-01)
- * — `colors.overlay.chipFill`/`chipBorder`, the same translucent-chip-over-art pattern
+ * Each icon sits on its own translucent circular chip — `colors.overlay.chipFill`/`chipBorder`, the same translucent-chip-over-art pattern
```

## `components/CircularProgress.tsx`

```diff
@@ line 16
-  /** Continuous rotation layered on top of the fill (Isaac's ask, session 2026-10-09 — the
-   * static fill "works but looks too standard"): the ring both fills AND spins while this
-   * is true, closer to the Netflix reference he pointed at, rather than sitting still as
-   * the stroke advances. Off by default — a caller with no active transfer to show has no
+  /** Continuous rotation layered on top of the fill: the ring both fills AND spins while
+   * this is true, rather than sitting still as the stroke advances. Off by default — a caller with no active transfer to show has no
@@ line 26
- * A YouTube-style circular progress ring (Isaac's ask, session 2026-10-08: download
- * buttons want real per-item progress feedback, not a generic spinner) — a static track
+ * A circular progress ring (real per-item download progress, not a generic spinner) — a
+ * static track
@@ line 34
- * Two polish passes added session 2026-10-09: the fill tweens toward each new `progress`
+ * The fill tweens toward each new `progress`
```

## `components/DetailError.tsx`

```diff
@@ line 9
-  /** Defaults to sermon-detail's original copy, its first consumer — series detail
-      (its second, Isaac's ask, session 2026-09-30) passes its own. */
+  /** Defaults to sermon detail's copy; series detail passes its own. */
```

## `components/DownloadPillButton.tsx`

```diff
@@ line 24
-   * episode — Isaac's ask, session 2026-10-08: the series page's pill downloads the
-   * whole series, not just one episode). Items with no rendition yet are the caller's
+   * episode: the series page's pill downloads the whole series). Items with no rendition yet are the caller's
@@ line 78
- * Full-width, dark-pill Download control (Isaac's ask, session 2026-09-30 — Netflix's
- * own title-page pair: a white Play pill directly above a gray Download pill, both the
- * same width). Promoted here, session 2026-10-01, once sermon detail adopted the same
- * pill skin in place of its own original `LinkButton`-based affordance — same
- * `useDownloads()` state machine underneath every mode, just one skin.
+ * Full-width, dark-pill Download control, sitting under the Play pill at the same width
+ * on sermon and series detail — the `useDownloads()` state machine underneath every mode.
@@ line 84
- * Generalized to a list of items (Isaac's ask, session 2026-10-08): sermon detail passes
- * one, series detail passes every episode — see `aggregate` above for how N items fold
+ * Takes a list of items: sermon detail passes one, series detail passes every episode — see `aggregate` above for how N items fold
@@ line 90
- * Active state renders the same Netflix-style `CircularProgress` fill ring
- * `EpisodeDownloadButton` uses (Isaac's ask, session 2026-10-09 — a linear bar read as
- * too passive; the ring is the one piece of real-time feedback a user watches fill up to
- * the completed checkmark), not a separate progress affordance of its own.
+ * Active state renders the same `CircularProgress` fill ring `EpisodeDownloadButton` uses
+ * (the one piece of real-time feedback a user watches fill up to the completed
+ * checkmark), not a separate progress affordance of its own.
```

## `components/EqualizerBars.tsx`

```diff
@@ line 23
- * The "now playing" audio-visualiser mark (Nii's ask, 2026-10-23: show it on the current
- * sermon while a playlist plays). Decorative bars, not a real spectrum — reading live
+ * The "now playing" audio-visualiser mark, shown on the current sermon while a playlist
+ * plays. Decorative bars, not a real spectrum — reading live
```

## `components/FadeTitle.tsx`

```diff
@@ line 18
- * edge instead of ending in an ellipsis (Isaac's reference: a streaming app's card
- * titles) — `ellipsizeMode="clip"` (no "…" glyph) plus a right-edge overlay of
+ * edge instead of ending in an ellipsis — `ellipsizeMode="clip"` (no "…" glyph) plus a right-edge overlay of
@@ line 25
- * Bold by explicit ask (both call sites' own commit). NOTE: theme/typography.ts documents
+ * Bold on purpose. NOTE: theme/typography.ts documents
```

## `components/FittedArt.tsx`

```diff
@@ line 27
- * Sermon/series artwork in a frame of any shape, never cropped (Nii's ask, 2026-10-23:
- * shelf covers were losing their titles to `cover` crops). Church art is designed as a
+ * Sermon/series artwork in a frame of any shape, never cropped (a `cover` crop cuts off
+ * the titles set in the art). Church art is designed as a
```

## `components/PlatformIcon.tsx`

```diff
@@ line 10
- * Every icon identity this app uses, iOS and Android side by side (Isaac's ask, session
- * 2026-10-09: "All icons used in the app should be device specific - iOS/Android").
- * Keyed on the Ionicons name the app already used everywhere pre-this-change — every
- * call site's icon *string* is unchanged, only the component rendering it (`Ionicons`
- * directly -> `PlatformIcon`) and, for the wrapper primitives (`IconButton`,
- * `ActionButton`, `PrimaryButton`/`Button`, `TransportControls`), the prop's declared
- * type (`ComponentProps<typeof Ionicons>['name']` -> `AppIconName` below). iOS renders
- * the original Ionicons glyph unchanged; Android renders a Material Icons equivalent —
+ * Every icon identity this app uses, iOS and Android side by side, so icons are
+ * device-specific. Keyed on the Ionicons name; the wrapper primitives (`IconButton`,
+ * `ActionButton`, `PrimaryButton`/`Button`, `TransportControls`) take an `AppIconName`
+ * (below). iOS renders the Ionicons glyph; Android renders a Material Icons equivalent —
@@ line 95
-  // Library tab (Isaac's ask, session 2026-10-10) — playlists + downloads. Icon
-  // switched to the "stacked cards" glyph Spotify/Apple Music both use for this exact
-  // meaning (Isaac's ask, session 2026-10-11: "use same used by apple music or
-  // spotify"), not the literal book-stack `library` glyph this used before — iOS's
+  // Library tab — playlists + downloads. The "stacked cards" glyph music apps use for
+  // this meaning, not the literal book-stack `library` glyph — iOS's
```

## `components/PopIn.tsx`

```diff
@@ line 12
- * Completion payoff (Isaac's ask, session 2026-10-09 — the download ring-to-checkmark
- * swap "works but looks too standard"): a small overshoot scale-and-fade-in, so the
+ * Completion payoff (e.g. the download ring-to-checkmark swap): a small overshoot scale-and-fade-in, so the
```

## `components/PressableScale.tsx`

```diff
@@ line 13
- * Tactile press feedback for Home's shelf cards (Isaac's ask, session 2026-09-30: "make it
- * more alive") — a subtle spring scale-down on press instead of the flat `opacity: 0.7`
- * every card previously used. Scoped to compact shelf cards (`SeriesCard`,
+ * Tactile press feedback for Home's shelf cards — a subtle spring scale-down on press
+ * rather than a flat opacity change. Scoped to compact shelf cards (`SeriesCard`,
@@ line 18
- * background tap reads as the page flexing, not a button responding, so that one keeps its
- * original opacity feedback.
+ * background tap reads as the page flexing, not a button responding, so that one keeps
+ * opacity feedback.
```

## `components/SearchField.tsx`

```diff
@@ line 21
- * The one search field the app draws (Search, Discover, Your library), so the three no
- * longer each look a little different (Nii, 2026-11-15: "tidy up the search bar, looks
- * out of place"). Shaped like the system search fields in Apple Music and Podcasts: a
+ * The one search field the app draws (Search, Discover, Your library), so the three look
+ * the same. Shaped like the system search fields in Apple Music and Podcasts: a
```

## `components/SectionError.tsx`

```diff
@@ line 20
- * convention, not the component itself. Promoted here from Home's own `_home/`
- * folder once the Library tab became a second consumer, same promotion bar
- * `Sheet`/`ConfirmDialog` already cleared this session.
+ * convention, not the component itself. Shared by Home and the Library tab.
```

## `components/Sheet.tsx`

```diff
@@ line 13
-   * needs to open a SECOND `Modal` right after this one closes (`PlaylistOptionsSheet`,
-   * Isaac's ask, session 2026-10-10) needs this, not just `onClose` — two native modals
+   * needs to open a SECOND `Modal` right after this one closes (`PlaylistOptionsSheet`)
+   * needs this, not just `onClose` — two native modals
@@ line 21
- * Bottom-sheet chrome, originally shared by the report, terms and name sheets (design
- * spec §2.4), promoted here from `app/player/_comments/` once the Me page's own avatar
- * picker (session 2026-10-09) became a second, unrelated feature area needing the exact
- * same chrome — same promotion bar `IconButton`/`Toggle`'s own doc comments describe. A
- * slide-up `Modal`, a `surface.app` scrim at 0.6 (the `SleepTimerSheet` precedent, no rgba
+ * Bottom-sheet chrome (design spec §2.4), shared by the comment report, terms and name
+ * sheets, the avatar picker and others. A slide-up `Modal`, a `surface.app` scrim at 0.6 (the `SleepTimerSheet` precedent, no rgba
```

## `components/SpeakerListRow.tsx`

```diff
@@ line 20
-/** Design spec 1i/2d: avatar chip (P6 hash), name, bio-or-fallback. The sermon count used
- *  to trail each row — dropped from the visible rendering (Isaac's ask, session
- *  2026-10-02) but still reaches VoiceOver via the accessibility label below. */
+/** Design spec 1i/2d: avatar chip (P6 hash), name, bio-or-fallback. The sermon count is
+ *  not drawn but reaches VoiceOver via the accessibility label below. */
```

## `components/StaggerItem.tsx`

```diff
@@ line 16
- * Per-card fade + rise-in for Home's shelves (Isaac's ask, session 2026-09-30: "make it
- * more alive"). Runs once per mount, not per re-render — a shelf's cards key off
+ * Per-card fade + rise-in for Home's shelves. Runs once per mount, not per re-render — a shelf's cards key off
```

## `components/SwipeToDelete.tsx`

```diff
@@ line 31
- * Swipe-left-to-reveal delete, built on core `PanResponder` + `Animated` (Isaac's ask,
- * session 2026-10-09: "the delete button is old fashioned, use something native,
- * creative and unique") — no `react-native-gesture-handler`/reanimated dependency added
- * for this: `PanResponder` already ships in React Native core and is the same primitive
+ * Swipe-left-to-reveal delete, built on core `PanResponder` + `Animated` — no
+ * `react-native-gesture-handler`/reanimated dependency: `PanResponder` already ships in React Native core and is the same primitive
```

## `components/__tests__/ProgressBar.test.tsx`

```diff
@@ line 26
-  // identical either way and so can't tell the two code paths apart) — per
-  // reviewer-gilfoyle's should-fix, they spy on `Animated.timing` itself, stubbed to a
+  // identical either way and so can't tell the two code paths apart) — they spy on `Animated.timing` itself, stubbed to a
```

## `components/__tests__/SpeakerListRow.test.tsx`

```diff
@@ line 42
-    // Visible count dropped (Isaac's ask, session 2026-10-02) — still reaches VoiceOver.
+    // Count is not shown visibly but still reaches VoiceOver.
```

## `components/navigation/MiniPlayer.tsx`

```diff
@@ line 72
- * Draggable (Nii, 2026-11-15): with `homeBottom` set, the card floats in a full-size layer
+ * Draggable: with `homeBottom` set, the card floats in a full-size layer
@@ line 76
- * place; let go near home and it docks back. Taps and its buttons work as before; a touch
+ * place; let go near home and it docks back. Taps and its buttons still work; a touch
```

## `components/navigation/NavIcon.tsx`

```diff
@@ line 17
- * The "You" tab (Isaac's ask, session 2026-10-11: "Change 'Me' tab to 'You' and include
- * avatar") renders the caller's own `Avatar` here instead of a generic person glyph,
- * same as every reference app with a profile-picture tab (YouTube's own "You"). Every
+ * The "You" tab renders the caller's own `Avatar` here instead of a generic person glyph.
+ * Every
```

## `components/navigation/StackMiniPlayer.tsx`

```diff
@@ line 13
- * notifications and so on). The tab group draws its own above the dock; until now nothing
- * drew it once a screen was pushed over the tabs (Nii's phone test, 2026-11-11). It floats
+ * notifications and so on). The tab group draws its own above the dock; this one covers
+ * screens pushed over the tabs. It floats
```

## `components/navigation/__tests__/MiniPlayerDrag.test.tsx`

```diff
@@ line 22
- * The draggable mini player (Nii, 2026-11-15). The drag itself is core `PanResponder`;
+ * The draggable mini player. The drag itself is core `PanResponder`;
```

## `components/navigation/routes.ts`

```diff
@@ line 31
-  // Browse is also the sole search entry point (Isaac's ask, session 2026-10-02) — the
-  // dedicated Search tab was removed; `app/search.tsx` is now a top-level stack route
+  // Browse is also the search entry point: `app/search.tsx` is a top-level stack route
@@ line 34
-  // Shown as "Discover" since the Daybreak redesign (2026-11); the route stays `browse`.
+  // Shown as "Discover"; the route stays `browse`.
@@ line 37
-    // Session 2026-10-10 (Isaac's ask): the former `downloads` destination (P1:
-    // "Downloads" on iOS, Android, and tablet alike) is renamed/absorbed into
-    // `library` — the Library tab holds downloaded content as one of its two
-    // sections, the other being user-created playlists (Spotify's own "Your
-    // Library" as the reference). Same href slot, same tab-bar position, just a
-    // bigger screen behind it; no new tab was added (phone bar stays at 4 items).
+    // The Library tab holds downloaded content and user-created playlists (it covers
+    // what plan P1 called "Downloads"). The phone bar stays at 4 items.
@@ line 56
-  // Label is "You", not "Me" (Isaac's ask, session 2026-10-11, YouTube's own "You" tab
-  // as the reference) — the route's own file/href stays `me` (an app-wide rename of the
-  // URL itself isn't what was asked for, just the visible label), and its icon shows
+  // Label is "You" — the route's own file/href stays `me`, and its icon shows
@@ line 66
- * the Daybreak redesign; it adds the raised Today button between the two halves). A dedicated Search tab existed here
- * originally; removed (Isaac's ask, session 2026-10-02) once Browse absorbed its
- * query/suggest/results flow as a pushed, not tabbed, screen.
+ * the Daybreak redesign; it adds the raised Today button between the two halves). There
+ * is no Search tab: Browse pushes the search screen.
```

## `components/series/EpisodeDownloadButton.tsx`

```diff
@@ line 27
- * Compact, icon-only download control at the far end of an `EpisodeRow` (Isaac's ask,
- * session 2026-09-30: "a download button at the far end of every item"). Same
+ * Compact, icon-only download control at the far end of an `EpisodeRow`. Same
@@ line 34
- * Downloading renders a real, YouTube-style circular progress ring (Isaac's ask, session
- * 2026-10-08 — "change the download button on the right to show a spinning animation with
- * progress and when done change the button to a completed status users will easily
- * identify"), not a generic indeterminate spinner: `CircularProgress` fills clockwise as
+ * Downloading renders a real circular progress ring, then a clear completed state, not a
+ * generic indeterminate spinner: `CircularProgress` fills clockwise as
```

## `components/sermon/ImageOnlyCard.tsx`

```diff
@@ line 25
- * `SermonCard`. Originally Home's "Recommended for you"/"Trending" shelves; the
- * series-detail "Related" rail became its second concrete consumer (Isaac's ask,
- * session 2026-10-01: drop the title and duration there too), which is why this moved
- * out of Home's own `_home/` folder into `components/sermon/` alongside `SermonCard`.
+ * `SermonCard`. Used by Home's "Recommended for you"/"Trending" shelves and the
+ * "Related" rail.
@@ line 35
- * edge-to-edge with no letterboxing (Isaac's call: source thumbnails are landscape,
- * Trending/Recommended's box is portrait 3:4, and a full card beats empty bars — cropping
- * some of the landscape edges is the accepted trade-off). RN centers the crop on both axes
+ * edge-to-edge with no letterboxing (source thumbnails are landscape, Trending/
+ * Recommended's box is portrait 3:4, and a full card beats empty bars — cropping some of
+ * the landscape edges is the accepted trade-off). RN centers the crop on both axes
```

## `components/sermon/RelatedSermons.tsx`

```diff
@@ line 16
-  /** Sermon detail's own Related section (Isaac's ask, session 2026-10-01): a 2-column
-      grid instead of series detail's horizontal rail. Defaults to the original
-      horizontal rail — series detail passes nothing and keeps that layout. */
+  /** Sermon detail's own Related section: a 2-column grid instead of series detail's
+      horizontal rail (the default). */
@@ line 23
-// Square (Isaac's follow-up ask, same session: "about half the size" of the original
-// 9:16 portrait card — 1:1 is close to that halving at this column width, and reads as
-// a deliberate square rather than an arbitrary in-between ratio).
+// Square: compact at this column width, and reads as a deliberate shape rather than an
+// arbitrary in-between ratio.
@@ line 27
-// Isaac's follow-up asks, same session: more breathing room than the original
-// near-touching gap (Netflix "More Like This" reference screenshot) — bumped once
-// already (xs to sm), then again here (sm to md).
+// Comfortable breathing room between cards.
@@ line 34
- * A "Related" rail of other sermons/episodes sharing a category (Isaac's ask, session
- * 2026-10-01 — series detail's "Related" tab originally showed whole other *series*;
- * corrected to standalone sermons and episodes instead, since a series card just routes
- * back into another title page rather than surfacing a specific thing to watch next).
- * Promoted here, same session, when sermon detail became its second consumer.
+ * A "Related" rail of other sermons/episodes sharing a category — sermons and episodes
+ * rather than whole series, since a series card just routes back into another title page
+ * rather than surfacing a specific thing to watch next. Used by series and sermon detail.
@@ line 50
- * Renders `ImageOnlyCard` (Isaac's ask, session 2026-10-01: no title, no duration under
- * each related item) — the same no-text card Home's own Recommended/Trending shelves
+ * Renders `ImageOnlyCard` (no title or duration under each item) — the same no-text card Home's own Recommended/Trending shelves
@@ line 99
-  // One episode per series (Isaac's ask, session 2026-10-01) — otherwise a series with
+  // One episode per series — otherwise a series with
```

## `components/sermon/SermonCard.tsx`

```diff
@@ line 25
-  /** A thin gold ring around the card — Prophet's Catalog only (Isaac's ask, session
-      2026-09-30: give the shelf's name a visual meaning, not just a text label). The
+  /** A thin gold ring around the card — Prophet's Catalog only (gives the shelf's name a
+      visual meaning, not just a text label). The
@@ line 43
- * (Isaac's ask, session 2026-09-30), and the series-detail "Related" rail's second
- * concrete consumer (session 2026-10-01), which is why this moved out of Home's own
- * `_home/` folder into `components/sermon/` alongside `SermonResultRow`. Same visual
+ * and the category/speaker grids. Same visual
@@ line 48
- * by Recommended/Trending — those two are algorithmic discovery shelves Isaac explicitly
- * wanted image-only; these are editorial/curated lists where the title carries real
+ * by Recommended/Trending — those two are algorithmic discovery shelves kept image-only;
+ * these are editorial/curated lists where the title carries real
```

## `lib/api/errors.ts`

```diff
@@ line 39
- * "Continue watching" shelf — previously three separately hand-written copies of the
- * same two-line function. */
+ * "Continue watching" shelf. */
```

## `lib/api/typedClient.ts`

```diff
@@ line 99
- * at the type level via `UnprefixedPaths` — so unlike an earlier draft of
- * this module, there is nothing left to strip here at runtime. `path` comes
+ * at the type level via `UnprefixedPaths`, so there is nothing to strip
+ * here at runtime. `path` comes
```

## `lib/auth/appleSignIn.ts`

```diff
@@ line 7
- * Apple Sign-In (client side, session 2026-10-15) — only ever offered on iOS (App Store
- * guideline 4.8 is an iOS-only rule, and the native module doesn't work on Android
- * either). Isaac hasn't enrolled in the paid Apple Developer Program yet, so the native
- * call will likely fail with no "Sign In with Apple" capability provisioned on a real
- * device right now; that failure is handled the same plain way as any other sign-in
- * failure, no special-casing, so this starts working with zero code changes once he
- * enrolls.
+ * Apple Sign-In (client side) — only ever offered on iOS (App Store guideline 4.8 is an
+ * iOS-only rule, and the native module doesn't work on Android either). A failure of the
+ * native call (e.g. no "Sign In with Apple" capability provisioned) is handled the same
+ * plain way as any other sign-in failure, no special-casing.
@@ line 83
- * Whether the Apple Sign-In button should render at all (Isaac's decision #3): a cheap
+ * Whether the Apple Sign-In button should render at all: a cheap
```

## `lib/auth/googleSignIn.ts`

```diff
@@ line 5
- * Google Sign-In (client side, session 2026-10-15). Uses the library's free "Original"
- * API (not the Firebase-backed one) — the architect's call, not relitigated here.
- * `webClientId`/`iosClientId` come from `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` /
- * `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` (`.env.example`), placeholders until Isaac supplies
- * the real Google Cloud Console OAuth client IDs — see `.env.example`'s own comment.
+ * Google Sign-In (client side). Uses the library's free "Original" API (not the
+ * Firebase-backed one). `webClientId`/`iosClientId` come from
+ * `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` / `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` (the Google
+ * Cloud Console OAuth client IDs) — see `.env.example`'s own comment.
```

## `lib/auth/session.ts`

```diff
@@ line 69
-  // S9 review (finding S1): a fresh sign-in re-opens media-cache fills that a prior
+  // A fresh sign-in re-opens media-cache fills that a prior
@@ line 75
-  // throws under test — confirmed empirically, not assumed. `require()` is plain
+  // throws under test. `require()` is plain
@@ line 82
-    // stays blocked until the following sign-in, never a crash. Gilfoyle re-check
-    // SHOULD-FIX: a dev-only breadcrumb, since this failing silently means a device
+    // stays blocked until the following sign-in, never a crash. A dev-only breadcrumb,
+    // since this failing silently means a device
@@ line 100
- * Bounded (S8/S9 review, finding S2): a hung SQLite/filesystem call inside the wipe must
+ * Bounded: a hung SQLite/filesystem call inside the wipe must
@@ line 112
-    // Gilfoyle re-check SHOULD-FIX: this is the one failure mode that actually matters —
+    // This is the one failure mode that actually matters —
@@ line 162
-    // user on the same device. In a `finally` (S8/S9 review, finding S2) so the wipe
+    // user on the same device. In a `finally` so the wipe
```

## `lib/content/commentsCompliance.ts`

```diff
@@ line 5
- * accepts before their first post (plan input I2). Both are supplied by Isaac.
+ * accepts before their first post (plan input I2). Both come from the church.
@@ line 11
- * I2 (comment guidelines) shipped 2026-10-08. I1 (contact email) shipped 2026-10-16 —
- * Isaac supplied `contact@rhemapod.com`.
- *
- * Since plan-admin-settings S18 both are editable by staff and served by
- * `GET /settings/public` (`useChurchContent()`); these constants are now the FALLBACK,
+ * Both are editable by staff and served by `GET /settings/public`
+ * (`useChurchContent()`); these constants are the FALLBACK,
```

## `lib/crypto/rpa1Format.ts`

```diff
@@ line 2
- * RPA1 — the on-disk format for encrypted offline audio downloads (plan W4.5 / GATE M9).
- * Full spec ruling: `status.md`, architect entry 2026-09-26T12:08:20Z ("RPA1 chunked
- * AES-256-GCM"), locked by Isaac's GATE M9 crossing (2026-09-27T20:05:00Z) with no
- * changes from that writeup.
+ * RPA1 — the on-disk format for encrypted offline audio downloads (plan W4.5 / GATE M9):
+ * chunked AES-256-GCM. The full spec is in `status.md` ("RPA1 chunked AES-256-GCM").
@@ line 16
- * bridge crossings per file; the architect's writeup's whole reason for a *native*
- * module was file-to-file, constant-memory streaming). This file's byte-layout
+ * bridge crossings per file; the reason for a *native* module is file-to-file,
+ * constant-memory streaming). This file's byte-layout
@@ line 53
-/** Default plaintext chunk size — 256 KiB, per the architect's writeup. */
+/** Default plaintext chunk size — 256 KiB, per the RPA1 writeup. */
@@ line 160
- * Mirrors Tink's streaming-AEAD construction, per the architect's writeup.
+ * Mirrors Tink's streaming-AEAD construction, per the RPA1 writeup.
```

## `lib/downloads/__tests__/db.test.ts`

```diff
@@ line 100
-        // value is load-bearing (the reviewer-gilfoyle-found orphan-file race fix in
+        // value is load-bearing (the orphan-file race fix in
```

## `lib/downloads/__tests__/downloadManager.test.ts`

```diff
@@ line 647
-describe('downloadManager — thumbnail fetch (session 2026-10-15 fix for the 6h presigned-URL expiry)', () => {
+describe('downloadManager — thumbnail fetch (the 6h presigned-URL expiry)', () => {
@@ line 728
-  it('reviewer-gilfoyle MUST-FIX regression: a download deleted while the thumbnail fetch is still in flight gets the orphaned file cleaned up, not left behind', async () => {
+  it('regression: a download deleted while the thumbnail fetch is still in flight gets the orphaned file cleaned up, not left behind', async () => {
```

## `lib/downloads/__tests__/installKey.test.ts`

```diff
@@ line 70
-   * Regression test for a real race `reviewer-gilfoyle` found: two concurrent
+   * Regression test for a race: two concurrent
```

## `lib/downloads/__tests__/useDownloads.test.ts`

```diff
@@ line 168
-  it('retry()\'s optimistic queued placeholder carries the existing thumbnailPath forward, not just thumbnailUrl/category (session 2026-10-15 thumbnail fix: setOptimisticQueued must not blank out a local thumbnail copy a prior successful download already recorded)', async () => {
+  it('retry()\'s optimistic queued placeholder carries the existing thumbnailPath forward, not just thumbnailUrl/category (setOptimisticQueued must not blank out a local thumbnail copy a prior successful download already recorded)', async () => {
```

## `lib/downloads/audioFormat.ts`

```diff
@@ line 5
- * extension and refuses one it doesn't recognise. The decrypted playback copy used to be
- * named `.pcm-tmp`, so every downloaded audio sermon failed to play on iPhone until the
- * download was removed and it streamed instead. The server accepts mp3, m4a/mp4, aac and
+ * extension and refuses one it doesn't recognise (a neutral extension such as `.pcm-tmp`
+ * makes every downloaded audio sermon fail to play on iPhone). The server accepts mp3, m4a/mp4, aac and
```

## `lib/downloads/db.ts`

```diff
@@ line 5
- * Download-state tracking, `expo-sqlite`, own dedicated database file — per the
- * architect's writeup (status.md 2026-09-26T12:08:20Z §4) and the GATE M9 crossing:
- * "expo-sqlite for download-state tracking in its own dedicated db file (not the
- * TanStack query-cache kv-store)". `lib/query/persister.ts` opens `expo-sqlite/kv-store`
+ * Download-state tracking, `expo-sqlite`, own dedicated database file (GATE M9, status.md
+ * §4: "expo-sqlite for download-state tracking in its own dedicated db file (not the
+ * TanStack query-cache kv-store)"). `lib/query/persister.ts` opens `expo-sqlite/kv-store`
@@ line 14
- * `downloading` rows at startup) — the architect's writeup explicitly rejected a KV blob
- * for this reason, so this uses `expo-sqlite`'s statement API directly rather than the
+ * `downloading` rows at startup) — a KV blob doesn't fit, so this uses `expo-sqlite`'s statement API directly rather than the
@@ line 77
-      // Migration (Isaac's ask, session 2026-10-08: video downloads). An install that
-      // already has this table predates `media_type` — `CREATE TABLE IF NOT EXISTS`
+      // Migration: `media_type` (video downloads). An install that already has this table
+      // predates `media_type` — `CREATE TABLE IF NOT EXISTS`
@@ line 88
-      // Migration (Isaac's ask, session 2026-10-09: Downloads list redesign — a real
-      // thumbnail and the sermon's category replacing the generic "Downloaded" text). Both
+      // Migration: `thumbnail_url` and `category` (shown on the Downloads list). Both
@@ line 99
-      // Migration (Isaac's ask, session 2026-10-15: fix for the 6h-expiring presigned
-      // `thumbnail_url` going blank/403 on a sermon that's been `ready` for a while).
-      // Nullable with no default, same reasoning as `thumbnail_url`/`category` above — an
-      // install that predates this fix just keeps showing the old (eventually-expiring)
-      // `thumbnailUrl` for its existing rows until re-downloaded; nothing here backfills
-      // them retroactively.
+      // Migration: the local thumbnail copy (the presigned `thumbnail_url` expires after 6h
+      // and goes blank/403 on a sermon that's been `ready` for a while). Nullable with no
+      // default, same reasoning as `thumbnail_url`/`category` above — rows from before
+      // this column keep showing their (eventually-expiring) `thumbnailUrl` until
+      // re-downloaded; nothing here backfills them.
@@ line 108
-      // Migration (offline playback fix, session 2026-10-22): the sermon's own
+      // Migration: the sermon's own
@@ line 219
-/** Session 2026-10-15 fix — records where the locally-fetched thumbnail copy landed (or
+/** Records where the locally-fetched thumbnail copy landed (or
@@ line 223
- * 0`) — `downloadManager.ts`'s `fetchThumbnailBestEffort` needs this to detect the
- * reviewer-gilfoyle-found race where `deleteDownload` removes the row while the thumbnail
+ * 0`) — `downloadManager.ts`'s `fetchThumbnailBestEffort` needs this to detect the race
+ * where `deleteDownload` removes the row while the thumbnail
```

## `lib/downloads/downloadManager.ts`

```diff
@@ line 319
-  /** Session 2026-10-15 fix for the 6h-expiring presigned `thumbnail_url` going blank/403
-   * on a sermon that's sat `ready` for a while — fetches a local, permanent copy once the
+  /** The presigned `thumbnail_url` expires after 6h and goes blank/403 on a sermon that's
+   * sat `ready` for a while, so this fetches a local, permanent copy once the
@@ line 327
-   * Reviewer-gilfoyle-found race (session 2026-10-15 fix): nothing gates `deleteDownload`
+   * Race with delete: nothing gates `deleteDownload`
@@ line 407
-   * Video's own, simpler path (Isaac's ask, session 2026-10-08): no encrypt pass, no RPA1
+   * Video's own, simpler path: no encrypt pass, no RPA1
@@ line 640
-   * `resumeQueuedDownloads` rather than failed — failing it turned every "waiting for
-   * Wi-Fi" download into an "interrupted" error on the next launch. Also unconditionally clears the
+   * `resumeQueuedDownloads` rather than failed (otherwise every "waiting for Wi-Fi"
+   * download would show as "interrupted" on the next launch). Also unconditionally clears the
@@ line 665
-   * for playback (path A, per the architect's writeup) and returns its `file://` path.
+   * for playback (path A, per the RPA1 writeup) and returns its `file://` path.
```

## `lib/downloads/installKey.ts`

```diff
@@ line 36
- * Found by `reviewer-gilfoyle`: without this, two downloads started back-to-back on a
+ * Without this, two downloads started back-to-back on a
```

## `lib/downloads/network.ts`

```diff
@@ line 24
- * without a module-graph edge back into the Downloads manager (that edge was a real
+ * without a module-graph edge back into the Downloads manager (that edge would be a
@@ line 26
- * downloadManager`, flagged at S8/S9 review). `downloadManager.ts` now imports this same
- * function instead of defining its own copy.
+ * downloadManager`). `downloadManager.ts` imports this same function.
```

## `lib/downloads/offlineDetails.ts`

```diff
@@ line 6
- * Offline playback (session 2026-10-22). The player reads `sermons.detail(id)` before it
- * ever looks at the local file, so a downloaded sermon whose detail wasn't already in the
- * query cache (never opened, or opened more than 24h ago, or the cache was wiped at
- * sign-out) showed "Something went wrong" with no network. Every `ready` download now
- * carries the `SermonDetail` saved when it finished; this copies it into the query cache
+ * Offline playback. The player reads `sermons.detail(id)` before it ever looks at the
+ * local file, so a downloaded sermon whose detail isn't in the query cache (never opened,
+ * opened more than 24h ago, or the cache was wiped at sign-out) would show "Something
+ * went wrong" with no network. Every `ready` download carries the `SermonDetail` saved
+ * when it finished; this copies it into the query cache
@@ line 14
- * on mount exactly as before and the saved copy is only ever a fallback. The thumbnail is
+ * on mount as usual and the saved copy is only ever a fallback. The thumbnail is
```

## `lib/downloads/paths.ts`

```diff
@@ line 4
- * File-path conventions for offline downloads (plan W4.5). Three distinct directories,
- * matching the architect's writeup's own separation (status.md 2026-09-26T12:08:20Z §2,
- * §4):
+ * File-path conventions for offline downloads (plan W4.5). Three distinct directories
+ * (status.md, RPA1 writeup §2, §4):
@@ line 54
-/** The local, permanent copy of the thumbnail image (session 2026-10-15 fix for the
- * 6h-expiring presigned `thumbnail_url` going blank/403 on a sermon that's sat `ready`
- * for a while — see `types.ts`'s own doc comment on `DownloadRecord.thumbnailPath`).
+/** The local, permanent copy of the thumbnail image (the presigned `thumbnail_url`
+ * expires after 6h — see `types.ts`'s own doc comment on `DownloadRecord.thumbnailPath`).
```

## `lib/downloads/types.ts`

```diff
@@ line 2
- * Offline downloads (plan W4.5, GATE M9; video added Isaac's ask, session 2026-10-08,
- * revisiting the GATE M9 "audio-only" lock). Shared types for the download-state store
+ * Offline downloads (plan W4.5, GATE M9), audio and video. Shared types for the download-state store
@@ line 12
- * time); video is a plain file under the OS's own sandbox/file protection only (Isaac's
- * call — `expo-video` needs to read a format it recognizes directly, which a
+ * time); video is a plain file under the OS's own sandbox/file protection only
+ * (`expo-video` needs to read a format it recognizes directly, which a
@@ line 49
-  /** Same reasoning as `title` — the Downloads tab's own thumbnail (session 2026-10-09
-   * redesign) reads this, not a second fetch. `null` for a sermon with no thumbnail, same
+  /** Same reasoning as `title` — the Downloads tab's own thumbnail reads this, not a second fetch. `null` for a sermon with no thumbnail, same
@@ line 53
-  /** A local, permanent copy of the thumbnail image, fetched once alongside the media
-   * (session 2026-10-15 fix) — `thumbnailUrl` is a presigned S3 URL with a ~6h expiry that
+  /** A local, permanent copy of the thumbnail image, fetched once alongside the media —
+   * `thumbnailUrl` is a presigned S3 URL with a ~6h expiry that
@@ line 57
-   * `thumbnailUrl` same as before this fix. */
+   * `thumbnailUrl`. */
@@ line 60
-   * replaces the Downloads list's old generic "Downloaded" label with the actual category
-   * (session 2026-10-09 redesign). `null` for an uncategorized sermon. */
+   * shown on the Downloads list. `null` for an uncategorized sermon. */
```

## `lib/downloads/useDownloads.ts`

```diff
@@ line 13
- * Backed by one shared store per `DownloadManager` instance (session 2026-10-09 fix),
- * not per-hook-instance `useState` — a single `useSyncExternalStore` subscription per
- * component, not an independent poll loop each. The earlier per-instance version meant a
- * series page's bulk "download all" pill (driven by its own `useDownloads()` call) could
- * enqueue every episode while each episode row's *own*, separate `useDownloads()`
- * instance never found out: that instance's local list was still empty at the moment the
- * pill fired, so its own "is anything active" check never saw a reason to start polling,
- * and the row's icon sat on "not downloaded" forever even after the file finished. Every
- * component sharing one store means one instance's `download()`/poll tick updates what
+ * Backed by one shared store per `DownloadManager` instance, not per-hook-instance
+ * `useState` — a single `useSyncExternalStore` subscription per component, not an
+ * independent poll loop each. With per-instance state, a series page's bulk "download
+ * all" pill could enqueue every episode while each episode row's own `useDownloads()`
+ * never started polling, leaving the row on "not downloaded" after the file finished.
+ * Every component sharing one store means one instance's `download()`/poll tick updates what
@@ line 150
- * `enqueueDownload`/`retryDownload` call (Isaac's ask, session 2026-10-09 — pressing
- * Download showed nothing for the 3–4 seconds it took the real call to resolve, since
+ * `enqueueDownload`/`retryDownload` call, so pressing Download shows something at once:
@@ line 153
- * finishes, not just the queue insert — long enough that a user would tap it again
- * thinking the first press missed). The real manager call's own, much faster internal
+ * finishes, not just the queue insert, and a few seconds of nothing reads as a missed
+ * tap. The real manager call's own, much faster internal
```

## `lib/format/publishedDate.ts`

```diff
@@ line 11
-/** `published_at` (ISO datetime) → just the year, e.g. "2026" (Isaac's ask, session
-    2026-10-01: sermon detail's meta line drops month/day down to year only). */
+/** `published_at` (ISO datetime) → just the year, e.g. "2026" (sermon detail's meta
+    line). */
```

## `lib/haptics.ts`

```diff
@@ line 4
- * Light haptic feedback for the app's few key moments (Nii, 2026-11-15: the premium feel
- * of Apple Music or Spotify). Kept deliberately sparse: play/pause, starting a download,
+ * Light haptic feedback for the app's few key moments. Kept deliberately sparse: play/pause, starting a download,
```

## `lib/mediaCache/events.ts`

```diff
@@ line 9
- * A closed union, not a `fill-skip:${string}` template literal (S9 review, N4): an open
+ * A closed union, not a `fill-skip:${string}` template literal: an open
```

## `lib/mediaCache/fill.ts`

```diff
@@ line 13
- * `isOnWifi` — Wi-Fi only, always, whatever the Downloads "Wi-Fi only" toggle says (Nii's
- * ask, 2026-10-23: don't spend data unnecessarily). Turning that toggle off is consent to
+ * `isOnWifi` — Wi-Fi only, always, whatever the Downloads "Wi-Fi only" toggle says (don't
+ * spend data unnecessarily). Turning that toggle off is consent to
@@ line 18
- * the Downloads manager (S8/S9 review: that edge was a real circular import,
- * `downloadManager -> mediaCache/dropSermon -> mediaCache/fill -> downloadManager`, fixed
- * by moving the function instead of living with the cycle). The transfer itself is NOT
+ * the Downloads manager (that edge would be a circular import,
+ * `downloadManager -> mediaCache/dropSermon -> mediaCache/fill -> downloadManager`). The transfer itself is NOT
@@ line 24
- * which the plan forbids. `realTransfer` below is a parallel, equally small implementation
+ * which the plan rules out. `realTransfer` below is a parallel, equally small implementation
@@ line 28
- * S3 implements only the free-space *floor* (an absolute reserve). The per-item
- * "50% of the computed quota" skip described alongside it needs `quota.ts`'s dynamic
- * formula (free + cache bytes), which doesn't exist until S5 — deliberately deferred,
- * not an oversight.
+ * Only the free-space *floor* (an absolute reserve) is enforced here; the plan's
+ * per-item "50% of the computed quota" skip is not implemented.
@@ line 102
- * S9 review (finding S3): nothing ever created `rpa-media-cache/` — confirmed nothing in
- * this module called `makeDirectoryAsync` at all, so every fill either silently failed,
- * or (worse, if the native download call happens to create parent dirs on some platform)
- * could succeed into a directory a wipe had just deleted. Same check-then-create shape as
+ * Creates `rpa-media-cache/` before a fill writes into it: without it every fill either
+ * silently fails, or (if the native download call happens to create parent dirs on some
+ * platform) succeeds into a directory a wipe had just deleted. Same check-then-create shape as
@@ line 143
-  /** Gilfoyle re-check MUST-FIX: set only by an explicit `cancelFill()` call for THIS
+  /** Set only by an explicit `cancelFill()` call for THIS
@@ line 160
- * S9 review (finding S1): the generation bump alone only protects a fill that was
+ * The generation bump alone only protects a fill that was
@@ line 197
-  // S9 review (finding S1): refuse outright after a wipe until a fresh sign-in re-opens
+  // Refuse outright after a wipe until a fresh sign-in re-opens
@@ line 204
-  // Gilfoyle (S8 MUST-FIX 1): a request for the SAME key as the one already in flight is
+  // A request for the SAME key as the one already in flight is
@@ line 253
-  // S9 review (finding S3): nothing created this directory before — confirmed, not
-  // assumed, via a repo-wide search. Idempotent (check-then-create), so a concurrent or
+  // Nothing else creates this directory. Idempotent (check-then-create), so a concurrent or
@@ line 274
-  // Gilfoyle (S8 MUST-FIX 1): `cancelled` was previously checked only once, right here —
-  // every await below (free-space, size-on-disk, rename, insert) was its own re-opened
-  // window where a cancel or a wipe landing mid-fill got silently ignored and the fill
-  // committed anyway. `isStale()` is re-checked before each one now.
+  // Every await below (free-space, size-on-disk, rename, insert) is its own window where
+  // a cancel or a wipe can land mid-fill, so `isStale()` is re-checked before each one,
+  // not just here.
@@ line 342
-  // Gilfoyle (S8 MUST-FIX 2, refined at re-check): re-checked once more, after the insert
+  // Re-checked once more, after the insert
@@ line 351
-  // surviving that would contradict S6's whole point. The re-check's first pass caught
-  // this correctly for cancellation-before-insert (`isStale()`, which does include
-  // `self.cancelled`); this is specifically the gap for cancellation-during-insert.
+  // surviving that would contradict S6's whole point. `isStale()` (which includes
+  // `self.cancelled`) covers cancellation before the insert; this covers cancellation
+  // during it.
```

## `lib/mediaCache/useCachedSource.ts`

```diff
@@ line 122
-      // Gilfoyle (S8 finding 4): pinned *before* the existence check, not after — a fill
+      // Pinned *before* the existence check, not after — a fill
@@ line 177
-  // — unmounted and restarted the player mid-play. The lookup still runs, so `reportExit`
+  // — would unmount and restart the player mid-play. The lookup still runs, so `reportExit`
```

## `lib/navigation/detailTransition.ts`

```diff
@@ line 8
- * "duration when popped" option. Isaac's asks (session 2026-10-01) wanted them to
- * differ: faster opening, slower closing. Two attempts at splitting them via
- * `navigation.setOptions` (a bare mount-time call, then one gated behind the
- * `transitionEnd` event) both failed to visibly change the close transition at all —
- * `react-native-screens` isn't reliably picking up a dynamically-changed
- * `animationDuration` on an already-pushed screen for this custom `slide_from_bottom` +
- * `gestureDirection: 'vertical'` combination, regardless of when the change is made.
- * Confirmed with Isaac (session 2026-10-01: "still same") rather than attempting a
- * fourth variant blind.
+ * "duration when popped" option. Splitting them via `navigation.setOptions` (at mount,
+ * or after the `transitionEnd` event) does not visibly change the close transition:
+ * `react-native-screens` doesn't pick up a dynamically-changed `animationDuration` on an
+ * already-pushed screen for this custom `slide_from_bottom` + `gestureDirection:
+ * 'vertical'` combination.
@@ line 18
- * Reverted to the one mechanism that's been reliable all along: a single static
- * `animationDuration`, applied once in `app/_layout.tsx`'s `Stack.Screen` options,
- * governing both the open and the close equally. 650ms confirmed working well (Isaac's
- * own words, session 2026-10-01: "working beautiful"); nudged up slightly from there.
+ * So it is a single static `animationDuration`, applied once in `app/_layout.tsx`'s
+ * `Stack.Screen` options, governing both the open and the close equally (a little over
+ * 650ms, which feels right on device).
@@ line 37
- * push to, given the current pathname (Isaac's follow-up ask, session 2026-10-01: the
- * push animation stopped showing from the second Related tap onward — `react-native-
- * screens` doesn't animate a push when the top two stack entries' route *names* repeat,
+ * push to, given the current pathname. `react-native-screens` doesn't animate a push when the top two stack entries' route *names* repeat,
```

## `lib/onboarding/slides.ts`

```diff
@@ line 9
- * First-launch onboarding content (Isaac's mockups, 3 slides) — "configurable out of
+ * First-launch onboarding content (3 slides) — "configurable out of
@@ line 14
- * Images are `assets/onboarding-{1,2,3}.jpg` — Isaac's real event photography. Swapping
- * one for another photo later is a one-line `require()` path change per slide, nothing
+ * Images are `assets/onboarding-{1,2,3}.jpg` — the church's own event photography.
+ * Swapping one for another photo is a one-line `require()` path change per slide, nothing
```

## `lib/playback/NowPlaying.tsx`

```diff
@@ line 62
- * One app-wide player (Daybreak stage 3, Nii's choice 2026-11-11: "Real mini player").
+ * One app-wide player. The player screen borrows this provider's single `VideoPlayer`
+ * (`useSharedPlayer`) rather than making its own, so when the screen closes the sermon
+ * keeps playing, with the mini player above the dock to pause it, reopen it or close it.
+ * Background audio and the lock-screen controls come from the player's flags.
@@ line 64
- * Before this, every player screen made its own `useVideoPlayer`, so leaving the screen
- * stopped the sermon. Now the screen borrows this provider's single `VideoPlayer`
- * (`useSharedPlayer`), and when the screen closes the sermon keeps playing, with the mini
- * player above the dock to pause it, reopen it or close it. Background audio and the
- * lock-screen controls come from the same player flags as before.
- *
- * Progress is still saved the same way (`useProgressFlush`, plan L16): by the player
+ * Progress is saved through `useProgressFlush` (plan L16): by the player
```

## `lib/playback/__tests__/NowPlaying.test.tsx`

```diff
@@ line 266
-describe('StackMiniPlayer (Nii, 2026-11-11: the mini player was missing on pushed screens)', () => {
+describe('StackMiniPlayer (the mini player on pushed screens)', () => {
```

## `lib/playback/miniPlayerPosition.ts`

```diff
@@ line 5
- * Where the listener has dragged the mini player (Nii, 2026-11-15: "allow mini player to
- * be dragged and repositioned on screen").
+ * Where the listener has dragged the mini player.
```

## `lib/playback/playerHero.ts`

```diff
@@ line 5
- * The artwork "flight" into the full player (Nii, 2026-11-15: open the player the way the
- * big audio apps do, with the art growing out of the mini player rather than a plain
- * screen sliding up).
+ * The artwork "flight" into the full player: the art grows out of the mini player rather
+ * than a plain screen sliding up.
```

## `lib/playback/queue.ts`

```diff
@@ line 4
- * The app-wide playback queue (Nii's review, 2026-11-14: "a queue that works everywhere
- * content plays"). Before this the queue lived in the player screen's route params and
- * only a playlist's Play/Shuffle could start one, so nothing queued outside a playlist and
- * nothing advanced once the player screen closed.
+ * The app-wide playback queue: it works everywhere content plays, and keeps advancing
+ * after the player screen closes.
```

## `lib/query/QueryProvider.tsx`

```diff
@@ line 9
- * Bump to discard every previously persisted cache on next launch. Bumped for the
- * sermon-comments release: the Notes endpoints and their cached `['notes', ...]` entries
- * are gone, and a restored cache must not carry them (or any shape written before the
- * comments keys existed) into the new build.
+ * Bump to discard every previously persisted cache on next launch, whenever a release
+ * removes or reshapes cached queries a restored cache must not carry into the new build.
@@ line 22
- * `stream` is excluded for the same shape of reason, found at S8/S9 review (B1/D11/D2):
+ * `stream` is excluded for the same shape of reason:
```

## `lib/query/__tests__/QueryProvider.test.tsx`

```diff
@@ line 30
-  it('never writes /stream responses to disk (S8/S9 review, B1/D11/D2 — a restored stale entitlement confirmation must not be possible)', () => {
+  it('never writes /stream responses to disk (a restored stale entitlement confirmation must not be possible)', () => {
```

## `lib/query/hooks/__tests__/useStream.test.ts`

```diff
@@ line 11
- * S8/S9 review, finding B1/D11/D2: the media cache's "every hit re-validates
+ * The media cache's "every hit re-validates
@@ line 21
-describe('useStream (S8/S9 review, finding B1/D11/D2)', () => {
+describe('useStream', () => {
```

## `lib/query/hooks/useNotificationsBadge.ts`

```diff
@@ line 8
- * Backs `HomeHeader`'s bell dot and the `/notifications` screen it opens (Isaac's
- * ask, session 2026-10-10: "Notification icon should open notifications page showing
- * new releases. Show counter"). Reuses `useNewReleases()` — Home's own "New Releases"
+ * Backs `HomeHeader`'s bell dot and the `/notifications` screen it opens (new
+ * releases, with a counter). Reuses `useNewReleases()` — Home's own "New Releases"
@@ line 14
- * Read/unread is tracked per sermon id (Isaac's follow-up, session 2026-10-11: "the
- * counter should respect read and unread items"), not a single "last seen" batch
- * timestamp — merely opening the Notifications screen no longer marks everything on it
- * as read; `markRead` is called per row, on tap (`notifications.tsx`'s own call site).
+ * Read/unread is tracked per sermon id, not a single "last seen" batch timestamp —
+ * merely opening the Notifications screen doesn't mark everything on it as read;
+ * `markRead` is called per row, on tap (`notifications.tsx`'s own call site).
```

## `lib/query/hooks/usePlaylists.ts`

```diff
@@ line 168
-/** The hero's "+" button's destination (Isaac's ask, session 2026-10-11: "add sermon to
- * default library") — there's no backend-flagged "default playlist" concept, so this is
+/** The hero's "+" button's destination (the viewer's default library) — there's no backend-flagged "default playlist" concept, so this is
@@ line 182
- * sermon isn't in yet, removes when it is — a genuine toggle (Isaac's ask, session
- * 2026-10-11: "allow user toggle"; it only added before, a press once already in did
- * nothing). `toggleSermons` (series detail — Isaac's ask, same session as the original
- * bulk add: every episode at once, the same bulk-operate-on-every-episode convention
- * this screen's own Download pill already established) removes every episode when all
+ * sermon isn't in yet, removes when it is. `toggleSermons` (series detail: every
+ * episode at once, the same convention as that screen's Download pill) removes every episode when all
```

## `lib/query/hooks/useProfile.ts`

```diff
@@ line 71
- * editor (session 2026-10-09), independent of `useUpdateFullName` above (the comments
- * flow's single-field name prompt, untouched). A name change goes through the same
+ * editor, independent of `useUpdateFullName` above (the comments flow's single-field
+ * name prompt). A name change goes through the same
```

## `lib/query/hooks/useSearch.ts`

```diff
@@ line 9
- * `lib/hooks/useDebouncedValue.ts` and its call site in `app/search.tsx` (a top-level
- * stack route since Isaac's ask, session 2026-10-02 — Browse absorbed the dedicated
- * Search tab, pushing here instead of switching tabs) — never the raw per-keystroke
+ * `lib/hooks/useDebouncedValue.ts` and its call site in `app/search.tsx` — never the raw per-keystroke
@@ line 41
- * hook's implicit default) starves whichever tab's items happen to sort past it (Isaac's
- * report, session 2026-10-10: "not all episodes are showing"). `/search` has no
+ * hook's implicit default) starves whichever tab's items happen to sort past it. `/search` has no
```

## `lib/query/hooks/useSermonProgress.ts`

```diff
@@ line 10
- * played. Conductor decision (W4.1, overriding the design spec §8.0/§8.8's originally
- * bound `/me/continue-watching` lookup): sermon-detail's Fresh-vs-Resume state calls this
+ * played. Sermon detail's (W4.1, in place of design spec §8.0/§8.8's
+ * `/me/continue-watching` lookup) Fresh-vs-Resume state calls this
```

## `lib/query/hooks/useSermons.ts`

```diff
@@ line 37
- * `PUT`/`DELETE /catalog/sermons/{sermon_id}/like` (Isaac's ask, session 2026-10-09: a
- * real counter and backend behind the Like button). Both are idempotent on the server —
+ * `PUT`/`DELETE /catalog/sermons/{sermon_id}/like` (the Like button and its counter). Both are idempotent on the server —
```

## `lib/query/hooks/useStream.ts`

```diff
@@ line 20
- * `staleTime: 0` and `refetchOnMount: 'always'` (S8/S9 review, finding B1/D11/D2): the
+ * `staleTime: 0` and `refetchOnMount: 'always'`: the
@@ line 49
- * of this" affordance (Isaac's ask, session 2026-10-10), which is sound-only by design —
+ * of this" affordance, which is sound-only by design —
```

## `lib/query/hooks/useWatchHistory.ts`

```diff
@@ line 21
- * `analytics_service.py`) — so a long-running series no longer misreads an
+ * `analytics_service.py`) — so a long-running series doesn't misread an
@@ line 24
- * form now.
+ * form.
```

## `lib/query/lifecycle.ts`

```diff
@@ line 7
- * React Native never fires — so before this, `refetchOnReconnect` did nothing and nothing
- * refreshed when the app came back to the foreground. This feeds it the two native
+ * React Native never fires — so on its own `refetchOnReconnect` does nothing and nothing
+ * refreshes when the app comes back to the foreground. This feeds it the two native
```

## `lib/query/queryClient.ts`

```diff
@@ line 68
-    // Episodes tabs, Isaac's ask, session 2026-10-10 — "not all episodes are showing,"
-    // the 20-result-cap root cause).
+    // Episodes tabs).
@@ line 152
-  // The Library tab's playlists (Isaac's ask, session 2026-10-10) — mirrors the
+  // The Library tab's playlists — mirrors the
```

## `lib/settings/notificationPreferences.ts`

```diff
@@ line 32
- * New-sermon pushes are on by default (Isaac, 2026-11-15): on Android 12 and older there is
- * no permission prompt, so an opt-in default meant most listeners never got them. Nothing
+ * New-sermon pushes are on by default: on Android 12 and older there is no permission
+ * prompt, so with an opt-in default most listeners would never get them. Nothing
```

## `lib/settings/notificationsSeen.ts`

```diff
@@ line 8
- * Per-item, not one "last seen" timestamp (Isaac's ask, session 2026-10-11: "the
- * counter should respect read and unread items" — a single batch timestamp marked
- * everything on the list as seen the instant the screen opened, whether or not any
- * specific item was actually looked at; this tracks which sermons were individually
- * opened instead). Capped at `MAX_STORED_IDS`, trimming the oldest entries first — New
+ * Per-item, not one "last seen" timestamp (which would mark everything on the list as
+ * seen the instant the screen opened): this tracks which sermons were individually
+ * opened. Capped at `MAX_STORED_IDS`, trimming the oldest entries first — New
```

## `lib/settings/onboardingSeen.ts`

```diff
@@ line 31
- * Dev-only escape hatch (Isaac's ask, 2026-10-16) so onboarding can be replayed on a test
+ * Dev-only escape hatch so onboarding can be replayed on a test
```

## `lib/share/shareContent.ts`

```diff
@@ line 12
- * attached — with a bare link, messengers render their own link card (Isaac's call at
- * plan-share-links SL0, reversing the 2026-10-09 "include image thumbnail" ask). The base
+ * attached — with a bare link, messengers render their own link card (plan-share-links
+ * SL0). The base
```

## `modules/rpa-crypto/__tests__/index.test.ts`

```diff
@@ line 109
-   * Regression test for a real bug `reviewer-gilfoyle` found (traced through
+   * Regression test (traced through
```

## `modules/rpa-crypto/android/src/main/java/expo/modules/rpacrypto/RpaCryptoModule.kt`

```diff
@@ line 19
- * third-party crypto). Plan W4.5 / GATE M9 (see `status.md`, architect entry
- * 2026-09-26T12:08:20Z, locked by Isaac's GATE M9 crossing 2026-09-27T20:05:00Z).
+ * third-party crypto). Plan W4.5 / GATE M9 (see `status.md`, "RPA1 chunked AES-256-GCM").
@@ line 24
- * (Jest-executable there; this file is NOT executable in this sandbox — no Gradle/Kotlin
- * toolchain available, see the mobile-developer status entry for the exact gap). If you
+ * (Jest-executable there; this file is only exercised by a real Android build). If you
@@ line 392
-   * runtime. Always returns `false` (never throws for this reason) — the architect's
-   * writeup already covers why this is acceptable: Android 10+ app-private storage is
+   * runtime. Always returns `false` (never throws for this reason) — the RPA1 writeup
+   * covers why this is acceptable: Android 10+ app-private storage is
```

## `modules/rpa-crypto/ios/RpaCryptoModule.swift`

```diff
@@ line 7
- * OpenSSL, no third-party crypto). Plan W4.5 / GATE M9 (see `status.md`, architect
- * entry 2026-09-26T12:08:20Z, locked by Isaac's GATE M9 crossing 2026-09-27T20:05:00Z).
+ * OpenSSL, no third-party crypto). Plan W4.5 / GATE M9 (see `status.md`, "RPA1 chunked
+ * AES-256-GCM").
@@ line 20
- * time, so memory stays constant regardless of file size — the whole reason this is a
- * native module rather than a third-party JSI crypto library (see the architect's
- * writeup: RNQC requires New Architecture, which this app does not run).
+ * time, so memory stays constant regardless of file size — the reason this is a native
+ * module with file-to-file streaming rather than a JS-facing crypto library.
@@ line 75
- * The previous shape here (`Error, CustomNSError`) was a real, must-fix bug caught by
- * `reviewer-gilfoyle`: `AsyncFunctionDefinition.swift`'s catch blocks only recognize
- * `catch let error as Exception` — a plain `CustomNSError` conformance falls through to
- * the generic `catch { callback(.failure(UnexpectedException(error))) }` branch instead,
- * so on a real iPhone every one of this module's throws (including
- * `E_RPA1_KEY_MISMATCH`) would have surfaced to JS as a generic, uncoded exception
- * instead of the specific `RpaErrorCode` `lib/downloads/downloadManager.ts` switches on
- * to degrade key-loss gracefully. `Exception` is a class (not a protocol) in this SDK
- * version, so the fix is to subclass it — `GenericException`'s own shape in
+ * Why a subclass and not `Error, CustomNSError`: `AsyncFunctionDefinition.swift`'s catch
+ * blocks only recognize `catch let error as Exception`. A plain `CustomNSError` conformance
+ * falls through to the generic `catch { callback(.failure(UnexpectedException(error))) }`
+ * branch, so every throw here (including `E_RPA1_KEY_MISMATCH`) would reach JS as a generic,
+ * uncoded exception instead of the specific `RpaErrorCode` `lib/downloads/downloadManager.ts`
+ * switches on to degrade key-loss gracefully. `Exception` is a class (not a protocol) in this SDK
+ * version, so we subclass it — `GenericException`'s own shape in
@@ line 421
-   * per the architect's writeup's mitigation for path A (decrypt-to-temp-file playback):
+   * per the RPA1 writeup's mitigation for path A (decrypt-to-temp-file playback):
```

## `modules/rpa-crypto/package.json`

```diff
@@ line 4
-  "description": "Local Expo native module for RPA1 chunked AES-256-GCM file encryption (offline downloads), using platform crypto (CryptoKit / javax.crypto) instead of a New Architecture-only third-party library.",
+  "description": "Local Expo native module for RPA1 chunked AES-256-GCM file encryption (offline downloads), using platform crypto (CryptoKit / javax.crypto) with file-to-file streaming.",
```

## `modules/rpa-crypto/src/RpaCryptoModule.ts`

```diff
@@ line 31
-   * Android, where FBE already covers at-rest device storage — see the architect's
-   * writeup, status.md 2026-09-26T12:08:20Z, §1's "honest note on the premise"). Returns
+   * Android, where FBE already covers at-rest device storage — see status.md's RPA1
+   * writeup, §1). Returns
```

## `theme/colors.ts`

```diff
@@ line 3
- * and `lightColors` (the light-mode design review, Isaac's artifact 2026-10-21).
+ * and `lightColors` (the light-mode design review).
@@ line 124
- * background" rather than an unrelated color. First use: onboarding's bottom card
- * (Isaac's ask, 2026-10-16: "the bottom parts looks too flat").
+ * background" rather than an unrelated color (e.g. onboarding's bottom card, which
+ * reads too flat without it).
@@ line 132
- * Daybreak redesign (2026-11, Nii's approved canvas). Navy and gold stay the brand; these
- * are the new surfaces the redesign adds, one group per surface so a later tweak to one
+ * Daybreak design. Navy and gold stay the brand; these are the surfaces Daybreak adds, one group per surface so a later tweak to one
@@ line 188
-  // Daily Rhema's "glass sun" (Nii, 2026-11-12, canvas D7 option A): a see-through gold
+  // Daily Rhema's "glass sun" (canvas D7 option A): a see-through gold
@@ line 192
-  // (the first build rendered near-solid gold, Nii 2026-11-12: "too bright").
+  // (the sun would render near-solid gold).
@@ line 280
- * - text.tertiary: #6E6858, one step darker than the review's #716B5A, which measured
- *   4.31:1 on `surface.sunken` (below AA). Now ≥4.5:1 on app, raised and sunken.
+ * - text.tertiary: #6E6858, one step darker than the review's #716B5A, which measures
+ *   4.31:1 on `surface.sunken` (below AA); this one is ≥4.5:1 on app, raised and sunken.
@@ line 290
- *   themes instead (Isaac's decision, 2026-10-21).
+ *   themes instead.
```

## `theme/typography.ts`

```diff
@@ line 54
-      ascenders never touch the line above (Nii, 2026-11-12: "not well formatted"). */
+      ascenders never touch the line above. */
@@ line 69
-  // `lineHeightRatio: 1` (exactly matching fontSize) was the one variant in this whole
-  // scale tighter than 1.2 — Isaac's ask, session 2026-10-10: "the owner's initials is
-  // not centered in the circle". A bold font's line box at `lineHeightRatio: 1` is
+  // Not `lineHeightRatio: 1` (exactly matching fontSize): a bold font's line box at `lineHeightRatio: 1` is
@@ line 77
-      Download), Isaac's ask, session 2026-10-01: smaller than `body`, bold rather than
+      Download): smaller than `body`, bold rather than
```
