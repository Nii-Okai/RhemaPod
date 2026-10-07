/**
 * Same screen as `sermon/[id]`, registered under a second route path (Isaac's ask,
 * session 2026-10-01: tapping a Related item should push with the regular horizontal
 * slide, not the vertical-dismiss gesture every other entry point uses).
 *
 * `react-native-screens`' transition-related `Stack.Screen` options (`animation`,
 * `gestureDirection`, `animationDuration`) are static per route in practice — an
 * earlier attempt at a *function* `options` prop computing them from `route.params`
 * (reading a `related` param) type-checked and unit-tested fine, but Isaac reported no
 * visible animation change on-device, meaning the native side isn't reliably picking up
 * a per-push variation that way. A second, differently-configured route is the one
 * mechanism proven reliable all session for this kind of thing: each route's
 * `Stack.Screen` options in `app/_layout.tsx` are a plain static object, read once.
 *
 * The `related=1` param (still passed by whoever navigates here — see `sermon/[id]`'s
 * and `series/[id]`'s own `goToRelatedSermon` functions) is unrelated to *this* file's
 * existence — that's what the shared component itself reads to decide whether to show
 * `CastCloseHeader`'s back chevron, independent of which route rendered it.
 */
export { default } from '../[id]';
