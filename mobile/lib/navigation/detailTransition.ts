/**
 * Shared push/pop timing for the two full-screen detail routes (`sermon/[id]`,
 * `series/[id]`) that use a native vertical dismiss gesture (`app/_layout.tsx`'s
 * `gestureDirection: 'vertical'`).
 *
 * `react-native-screens`' `animationDuration` is a single value per screen that governs
 * both directions of its transition — there's no separate "duration when pushed" vs
 * "duration when popped" option. Isaac's asks (session 2026-10-01) wanted them to
 * differ: faster opening, slower closing. Two attempts at splitting them via
 * `navigation.setOptions` (a bare mount-time call, then one gated behind the
 * `transitionEnd` event) both failed to visibly change the close transition at all —
 * `react-native-screens` isn't reliably picking up a dynamically-changed
 * `animationDuration` on an already-pushed screen for this custom `slide_from_bottom` +
 * `gestureDirection: 'vertical'` combination, regardless of when the change is made.
 * Confirmed with Isaac (session 2026-10-01: "still same") rather than attempting a
 * fourth variant blind.
 *
 * Reverted to the one mechanism that's been reliable all along: a single static
 * `animationDuration`, applied once in `app/_layout.tsx`'s `Stack.Screen` options,
 * governing both the open and the close equally. 650ms confirmed working well (Isaac's
 * own words, session 2026-10-01: "working beautiful"); nudged up slightly from there.
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
 * push to, given the current pathname (Isaac's follow-up ask, session 2026-10-01: the
 * push animation stopped showing from the second Related tap onward — `react-native-
 * screens` doesn't animate a push when the top two stack entries' route *names* repeat,
 * even though `router.push` always creates a genuinely distinct JS state entry either
 * way; see `app/sermon/related2/[id].tsx`'s own doc comment for the full mechanism).
 * Alternating ensures two consecutive Related taps never push the same route name.
 */
export function nextRelatedSermonRoute(currentPathname: string): typeof RELATED_ROUTE_A | typeof RELATED_ROUTE_B {
  return currentPathname.startsWith('/sermon/related/') ? RELATED_ROUTE_B : RELATED_ROUTE_A;
}
