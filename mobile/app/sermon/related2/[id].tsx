/**
 * A second copy of `sermon/related/[id]` (same screen, same `Stack.Screen` options) —
 * Isaac's follow-up ask, session 2026-10-01: tapping Related from *within* a Related
 * screen pushed `sermon/related/[id]` on top of itself (same route name twice in a
 * row), and the animation stopped showing from that second level on, even though
 * `router.push` genuinely creates a new, distinct stack entry each time (expo-router's
 * own `linkTo` generates a unique `__EXPO_ROUTER_key` per push specifically so
 * `getId()`-based route matching never collapses two pushes of the same route —
 * verified in `expo-router/build/global-state/routing.js`'s own `getNavigateAction`
 * comment). The JS navigation state is correct either way; this is
 * `react-native-screens`' native side not animating a push when the route *name* at the
 * top of the stack repeats, even with a different key/params underneath.
 *
 * `sermon/[id].tsx`'s own `goToRelatedSermon` alternates between this route and
 * `sermon/related/[id]` based on the current pathname, so two consecutive Related taps
 * never push the same route name twice — see that function's own comment.
 */
export { default } from '../[id]';
