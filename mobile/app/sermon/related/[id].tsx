/**
 * Same screen as `sermon/[id]`, registered under a second route path so tapping a Related
 * item pushes with the regular horizontal slide, not the vertical-dismiss gesture every
 * other entry point uses.
 *
 * `react-native-screens`' transition-related `Stack.Screen` options (`animation`,
 * `gestureDirection`, `animationDuration`) are static per route in practice: a *function*
 * `options` prop computing them from `route.params` type-checks and unit-tests fine but
 * makes no visible difference on device. A second, differently-configured route is
 * reliable: each route's `Stack.Screen` options in `app/_layout.tsx` are a plain static
 * object, read once.
 *
 * The `related=1` param (still passed by whoever navigates here — see `sermon/[id]`'s
 * and `series/[id]`'s own `goToRelatedSermon` functions) is unrelated to *this* file's
 * existence — that's what the shared component itself reads to decide whether to show
 * `CastCloseHeader`'s back chevron, independent of which route rendered it.
 */
export { default } from '../[id]';
