import type { AppIconName } from '../PlatformIcon';

export type NavRouteKey =
  | 'home'
  | 'series'
  | 'browse'
  | 'library'
  | 'announcements'
  | 'me';

export interface NavRoute {
  /** Logical destination id — the single source of truth every chrome variant reads from. */
  key: NavRouteKey;
  /** The screen route, defined once under `app/(tabs)/**` — never forked per platform (plan L15). */
  href: `/(tabs)/${string}`;
  /** iOS tab label (text-only) and the label paired with an icon on Android/tablet. */
  label: string;
  icon: AppIconName;
  iconActive: AppIconName;
}

/**
 * One definition per logical destination (plan L15/§A.7; W3.4 verification: "no route
 * path differs by platform"). The chrome components in this folder each select a
 * *subset* of this list via `PHONE_NAV_KEYS`/`TABLET_RAIL_KEYS` — none of them redefine
 * a route's `href` or introduce a platform-specific variant of it.
 */
export const NAV_ROUTES: readonly NavRoute[] = [
  { key: 'home', href: '/(tabs)/home', label: 'Home', icon: 'home-outline', iconActive: 'home' },
  { key: 'series', href: '/(tabs)/series', label: 'Series', icon: 'layers-outline', iconActive: 'layers' },
  // Browse is also the sole search entry point (Isaac's ask, session 2026-10-02) — the
  // dedicated Search tab was removed; `app/search.tsx` is now a top-level stack route
  // Browse pushes into, not a tab destination.
  { key: 'browse', href: '/(tabs)/browse', label: 'Browse', icon: 'grid-outline', iconActive: 'grid' },
  {
    // Session 2026-10-10 (Isaac's ask): the former `downloads` destination (P1:
    // "Downloads" on iOS, Android, and tablet alike) is renamed/absorbed into
    // `library` — the Library tab holds downloaded content as one of its two
    // sections, the other being user-created playlists (Spotify's own "Your
    // Library" as the reference). Same href slot, same tab-bar position, just a
    // bigger screen behind it; no new tab was added (phone bar stays at 4 items).
    key: 'library',
    href: '/(tabs)/library',
    label: 'Library',
    icon: 'library-outline',
    iconActive: 'library',
  },
  {
    key: 'announcements',
    href: '/(tabs)/announcements',
    label: 'Announcements',
    icon: 'megaphone-outline',
    iconActive: 'megaphone',
  },
  // Label is "You", not "Me" (Isaac's ask, session 2026-10-11, YouTube's own "You" tab
  // as the reference) — the route's own file/href stays `me` (an app-wide rename of the
  // URL itself isn't what was asked for, just the visible label), and its icon shows
  // the caller's own avatar instead of this generic fallback glyph (`NavIcon`'s own
  // doc comment) whenever profile data has loaded.
  { key: 'me', href: '/(tabs)/me', label: 'You', icon: 'person-outline', iconActive: 'person' },
] as const;

/**
 * iOS 4-tab bar + Android 4-item M3 nav bar — the same four destinations, just two
 * different chromes (design spec §2, plan W3.4). A dedicated Search tab existed here
 * originally; removed (Isaac's ask, session 2026-10-02) once Browse absorbed its
 * query/suggest/results flow as a pushed, not tabbed, screen.
 */
export const PHONE_NAV_KEYS: readonly NavRouteKey[] = ['home', 'browse', 'library', 'me'] as const;

/**
 * Tablet rail — five destinations, not a re-skin of the phone set. `series` and
 * `announcements` have no phone equivalent by design (planner resolution P3: the rail
 * has room the phone tab bar doesn't; not a gap to fix on phone). `me` is reached via
 * the rail's avatar row instead of a dedicated item (design spec §2), so it's
 * intentionally absent here.
 */
export const TABLET_RAIL_KEYS: readonly NavRouteKey[] = [
  'home',
  'series',
  'browse',
  'library',
  'announcements',
] as const;

export function routeByKey(key: NavRouteKey): NavRoute {
  const route = NAV_ROUTES.find((candidate) => candidate.key === key);
  if (!route) throw new Error(`Unknown nav route key: ${key}`);
  return route;
}

/** Strips the `(tabs)` route-group segment so a route can be compared against `usePathname()`. */
export function pathnameFor(route: NavRoute): string {
  return route.href.replace('/(tabs)', '');
}

/** True for the route's own screen and any of its nested sub-routes, not sibling prefixes. */
export function isRouteActive(pathname: string, route: NavRoute): boolean {
  const match = pathnameFor(route);
  return pathname === match || pathname.startsWith(`${match}/`);
}
