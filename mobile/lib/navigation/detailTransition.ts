/**
 * Shared push/pop timing for the two full-screen detail routes (`sermon/[id]`,
 * `series/[id]`) that use a native vertical dismiss gesture (`app/_layout.tsx`'s
 * `gestureDirection: 'vertical'`).
 *
 * `react-native-screens`' `animationDuration` is a single value per screen that governs
 * both directions of its transition — there's no separate "duration when pushed" vs
 * "duration when popped" option. Splitting them via `navigation.setOptions` (at mount,
 * or after the `transitionEnd` event) does not visibly change the close transition:
 * `react-native-screens` doesn't pick up a dynamically-changed `animationDuration` on an
 * already-pushed screen for this custom `slide_from_bottom` + `gestureDirection:
 * 'vertical'` combination.
 *
 * So it is a single static `animationDuration`, applied once in `app/_layout.tsx`'s
 * `Stack.Screen` options, governing both the open and the close equally (a little over
 * 650ms, which feels right on device).
 */
export const DETAIL_TRANSITION_DURATION = 750;

/** The query param `sermon/[id]`/`sermon/related/[id]`/`sermon/related2/[id]` itself
    reads (`CastCloseHeader`'s own `onBack` prop) to show a back chevron instead of just
    Cast+Close. Orthogonal to which of those three *routes* rendered the screen — see
    `app/sermon/related/[id].tsx`'s own doc comment for why there's more than one. */
export const RELATED_PARAM = 'related' as const;
export const RELATED_PARAM_VALUE = '1' as const;

const RELATED_ROUTE_A = '/sermon/related/[id]' as const;
const RELATED_ROUTE_B = '/sermon/related2/[id]' as const;

/**
 * Which of the two identically-configured "Related" routes a *new* Related tap should
 * push to, given the current pathname. `react-native-screens` doesn't animate a push when the top two stack entries' route *names* repeat,
 * even though `router.push` always creates a genuinely distinct JS state entry either
 * way; see `app/sermon/related2/[id].tsx`'s own doc comment for the full mechanism).
 * Alternating ensures two consecutive Related taps never push the same route name.
 */
export function nextRelatedSermonRoute(currentPathname: string): typeof RELATED_ROUTE_A | typeof RELATED_ROUTE_B {
  return currentPathname.startsWith('/sermon/related/') ? RELATED_ROUTE_B : RELATED_ROUTE_A;
}
