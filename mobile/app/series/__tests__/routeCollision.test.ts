import { isRouteActive, pathnameFor, routeByKey } from '../../../components/navigation/routes';

/**
 * W4.4 owns `/series/[id]` (this slice), a top-level stack route registered
 * in `app/_layout.tsx` — distinct from the tablet-only `(tabs)/series` rail
 * tab (`app/(tabs)/series.tsx`, plan L15/P3), which lists series rather than
 * showing one series' detail. Both live under the `/series` path prefix by
 * Expo Router's file-based routing (`app/(tabs)/series.tsx` -> `/series`,
 * `app/series/[id].tsx` -> `/series/[id]`) — these are two distinct
 * registered routes, not a literal path collision (Expo Router only
 * conflicts on an exact duplicate path, and `/series` !== `/series/[id]`).
 * `isRouteActive`'s own "nested sub-routes" rule (routes.ts) means the
 * tablet rail's Series tab is correctly shown as selected while a series
 * detail screen is on top of it — that's the intended UX, not a bug.
 */
describe('series/[id] route ownership (plan W4.4, coordinated with W4.1)', () => {
  it('is a distinct literal path from the tablet Series rail tab', () => {
    const seriesTab = routeByKey('series');
    expect(pathnameFor(seriesTab)).toBe('/series');
    expect('/series/[id]').not.toBe(pathnameFor(seriesTab));
  });

  it('a real series-detail pathname is treated as a nested sub-route of the Series tab, not a separate top-level tab', () => {
    const seriesTab = routeByKey('series');
    expect(isRouteActive('/series/11111111-1111-1111-1111-111111111111', seriesTab)).toBe(true);
    // ...but a detail pathname never equals the tab's own exact route.
    expect('/series/11111111-1111-1111-1111-111111111111').not.toBe(pathnameFor(seriesTab));
  });
});
