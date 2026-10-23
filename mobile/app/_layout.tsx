import { Stack } from 'expo-router';
import { StatusBar } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider, useAuthGuard } from '../lib/auth/AuthContext';
import { DETAIL_TRANSITION_DURATION } from '../lib/navigation/detailTransition';
import { QueryProvider } from '../lib/query/QueryProvider';
import { ThemeProvider, useTheme } from '../theme/ThemeContext';

function RootNavigator() {
  useAuthGuard();
  const { scheme, colors } = useTheme();

  return (
    <>
      {/* Light status-bar glyphs on the dark palette, dark glyphs on the light one. */}
      <StatusBar barStyle={scheme === 'light' ? 'dark-content' : 'light-content'} />
      {/* Every screen paints its own background, but the native container shows through
          during push/pop transitions — keep it on the active palette so a light screen
          never slides over a dark flash (or the reverse). */}
      <Stack screenOptions={{ contentStyle: { backgroundColor: colors.surface.app } }}>
        <Stack.Screen name="index" options={{ headerShown: false }} />
        {/* First-launch onboarding (Isaac's mockups) — pre-auth, reached only from `/`'s own
            redirect before any account is known. See `app/onboarding.tsx`'s own doc
            comment. */}
        <Stack.Screen name="onboarding" options={{ headerShown: false }} />
        <Stack.Screen name="(auth)" options={{ headerShown: false }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        {/* W4.3 — top-level stack routes outside the tab chrome (plan L15/§A.7):
            identical on every platform, reached from search results and the
            Browse category/speaker drill-down lists. */}
        {/* W4.1 — sermon-detail owns its own header (Cast+Close chrome, `CastCloseHeader`,
            session 2026-10-01 — originally the platform-swapped `DetailHeader`, since
            removed with no other consumers left), so the native Stack header is fully
            disabled here rather than just given an empty title.
            `gestureDirection: 'vertical'` + `fullScreenGestureEnabled` (Isaac's ask,
            session 2026-10-01 — "pull down to go back, YouTube style") hands the whole
            pull-to-dismiss interaction to `react-native-screens`' own native transition
            instead of a hand-rolled one: the real previous screen shows through as it's
            dragged, the drag tracks the finger exactly (native UIKit interactive
            transition, not a JS-driven approximation), and a released-but-undercommitted
            drag springs back with real velocity rather than a scripted-duration tween.
            A from-scratch `Animated`-based version of this (session 2026-10-01, since
            removed) got all three wrong: the ScrollView's own rubber-band and the
            wrapper's transform fought each other, touches starting on the hero (outside
            the ScrollView) produced no drag at all, and the exit was a fixed-duration
            tween with no sense of how fast the finger was moving.
            `animationDuration` here is one static value governing both the push-in and
            the pop — Isaac's asks (session 2026-10-01) wanted open and close to differ,
            but two attempts at dynamically overriding it per-direction via
            `navigation.setOptions` both failed to visibly affect the close transition at
            all (`react-native-screens` isn't reliably picking up a dynamic change for
            this custom animation + `gestureDirection: 'vertical'` combination) — see
            `detailTransition.ts`'s own doc comment for the full history. Reverted to the
            one mechanism that's actually reliable: a single shared duration.
            `animation: 'slide_from_bottom'` — a brief detour through `fade_from_bottom`
            (session 2026-10-01, chasing a dark-overlay-on-the-revealed-screen effect that
            turned out to need a genuine `presentation: 'modal'` switch, which Isaac
            declined) was reverted back to this.
            A tapped Related item pushes `sermon/related/[id]` below instead of this route
            — a *second*, differently-configured route rendering the exact same screen
            component (Isaac's ask, same session: the regular horizontal slide there, not
            this route's vertical-dismiss gesture, since it's a drill-down on top of an
            existing detail screen). A function `options` prop computing this per
            `route.params` was tried first and didn't visibly change the animation
            on-device — see `app/sermon/related/[id].tsx`'s own doc comment for why a
            second static route replaced it. */}
        <Stack.Screen
          name="sermon/[id]"
          options={{
            headerShown: false,
            gestureDirection: 'vertical',
            fullScreenGestureEnabled: true,
            animation: 'slide_from_bottom',
            animationDuration: DETAIL_TRANSITION_DURATION,
          }}
        />
        {/* Same screen component as `sermon/[id]` above, a second route purely so this
            entry point's `Stack.Screen` options can differ — see
            `app/sermon/related/[id].tsx`'s own doc comment. Deliberately the library's
            actual platform default (`gestureDirection`/`animation` both omitted, not set
            to the vertical/slide_from_bottom pair above) — the regular right-to-left push,
            standard edge-swipe-back, same as `category/[id]`/`speaker/[id]` below. */}
        <Stack.Screen name="sermon/related/[id]" options={{ headerShown: false }} />
        {/* A *third* copy of the same screen, identically configured to the one above —
            Isaac's follow-up ask, same session: tapping Related again from within
            `sermon/related/[id]` pushed that same route name onto itself, and
            `react-native-screens` didn't animate a push when the top two stack entries'
            route *names* repeat (even though expo-router's own `router.push` always
            creates a genuinely distinct JS state entry either way — this is a native-side
            quirk, not a JS navigation bug). `sermon/[id].tsx`'s own `goToRelatedSermon`
            alternates between this route and the one above by current pathname, so
            consecutive Related taps never repeat a route name — see
            `app/sermon/related2/[id].tsx`'s own doc comment. */}
        <Stack.Screen name="sermon/related2/[id]" options={{ headerShown: false }} />
        {/* Search tab removed (Isaac's ask, session 2026-10-02): Browse is now the sole
            search entry point, pushing here rather than switching tabs. Owns its own header
            (back chevron + the search field itself, same pill position as Browse's own
            search entry) — the native Stack header is disabled, and `animation: 'none'`
            (Isaac's follow-up ask, same session) means tapping Browse's search bar swaps
            straight to this screen with no slide/fade, since the search field itself
            visually continues from the same spot. */}
        <Stack.Screen name="search" options={{ headerShown: false, animation: 'none' }} />
        {/* Owns its own header (back chevron + centered title), same pattern as
            `series.tsx`'s own phone header (Isaac's ask, session 2026-10-02: "same
            navigation style as all series page") — the native Stack header (which on iOS
            would show "< Browse" next to the chevron, not a bare chevron) is disabled here
            for the same reason sermon/series detail disable it above. */}
        <Stack.Screen name="category/[id]" options={{ headerShown: false }} />
        {/* Session 2026-10-11 (Isaac's report: "use preestablish navigation style") — this
            had no `options` at all, so it fell through to the Stack's own default native
            header (title text + "< Browse" back label) instead of the bare-chevron +
            centered-title pattern every other drill-down screen here uses. Now matches
            `category/[id]` above. */}
        <Stack.Screen name="speaker/[id]" options={{ headerShown: false }} />
        {/* The player rises from the bottom (its header closes with a chevron-down) and can
            be pulled down to dismiss. Every sermon tap in the app lands here directly, so
            this is the only transition between picking a sermon and hearing it (Nii's ask,
            2026-10-23: previously sermon detail slid up, then replaced itself with this). */}
        <Stack.Screen
          name="player/[id]"
          options={{
            headerShown: false,
            gestureDirection: 'vertical',
            animation: 'slide_from_bottom',
          }}
        />
        {/* W4.4 — series detail, another top-level stack route (plan L15):
            identical on every platform, reached from Home's Series shelf
            (W4.1), Browse, and the tablet Series rail tab. Distinct from the
            tablet-only `(tabs)/series` rail tab (which lists series, not one
            series' detail) — see `app/series/__tests__/routeCollision.test.ts`.
            Owns its own header (`CastCloseHeader`, same as `sermon/[id]` above) —
            same reasoning: the native Stack header is fully disabled rather than
            just given an empty title. Same native vertical-dismiss gesture, same shared
            `animationDuration`, same `slide_from_bottom` animation, as `sermon/[id]`
            above, same reasoning. */}
        <Stack.Screen
          name="series/[id]"
          options={{
            headerShown: false,
            gestureDirection: 'vertical',
            fullScreenGestureEnabled: true,
            animation: 'slide_from_bottom',
            animationDuration: DETAIL_TRANSITION_DURATION,
          }}
        />
        {/* Session 2026-10-10 — the Library tab's playlist detail screen, reached from
            `(tabs)/library`. Native Stack header disabled, replaced by its own plain
            back-chevron row — same "back chevron, no `<Library` label next to it" header
            `category/[id].tsx` already established, not sermon/series detail's own
            Cast+Close chrome (no cast surface here, and this isn't a dismiss-gesture
            title page). See the screen's own doc comment. */}
        <Stack.Screen name="playlist/[id]" options={{ headerShown: false }} />
        {/* "Give your playlist a name" -> Create (Isaac's screenshots) — a genuine modal
            presentation (the reference's full-bleed dark takeover with an X close, not a
            push), reached from Library's own "New playlist" button and from the playlist
            detail screen's options menu is NOT a caller — creation only ever starts from
            Library. */}
        <Stack.Screen name="playlist/create" options={{ headerShown: false, presentation: 'modal' }} />
        {/* Session 2026-10-11 — Home's bell icon opens this instead of Announcements
            (`HomeTopBar`'s own doc comment). Owns its own header (back chevron + centered
            title), same "native Stack header disabled" pattern `category/[id]` and
            `series.tsx`'s own phone header established — missing this entry here (Isaac's
            report, same session: "Use previously established style for navigation page")
            left the native default header showing on top of this screen's own custom one. */}
        <Stack.Screen name="notifications" options={{ headerShown: false }} />
        {/* Sermon comments — Me > Blocked users (design spec comments-and-player §3.2).
            Bare-chevron + centered-title header, same "native Stack header disabled"
            pattern `category/[id]`/`speaker/[id]`/`notifications` established (Isaac's
            report, session 2026-10-16: "use preestablish navigation style" — this had no
            `options` at all, same gap `speaker/[id]` had session 2026-10-11). */}
        <Stack.Screen name="blocked-users" options={{ headerShown: false }} />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <QueryProvider>
        <AuthProvider>
          <ThemeProvider>
            <RootNavigator />
          </ThemeProvider>
        </AuthProvider>
      </QueryProvider>
    </SafeAreaProvider>
  );
}
