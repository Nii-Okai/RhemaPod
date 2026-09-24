import type { ComponentProps } from 'react';
import type { Ionicons } from '@expo/vector-icons';

export type NavRouteKey =
  | 'home'
  | 'series'
  | 'browse'
  | 'search'
  | 'downloads'
  | 'announcements'
  | 'me';

export interface NavRoute {
  /** Logical destination id — the single source of truth every chrome variant reads from. */
  key: NavRouteKey;
  /** The screen route, defined once under `app/(tabs)/**` — never forked per platform (plan L15). */
  href: `/(tabs)/${string}`;
  /** iOS tab label (text-only) and the label paired with an icon on Android/tablet. */
  label: string;
  icon: ComponentProps<typeof Ionicons>['name'];
  iconActive: ComponentProps<typeof Ionicons>['name'];
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
  { key: 'browse', href: '/(tabs)/browse', label: 'Browse', icon: 'grid-outline', iconActive: 'grid' },
  { key: 'search', href: '/(tabs)/search', label: 'Search', icon: 'search-outline', iconActive: 'search' },
  {
    key: 'downloads',
    // P1 (planner resolution): "Downloads" on iOS, Android, and tablet alike — never
    // "Saved". Only one screen (1l) was ever designed for this destination.
    href: '/(tabs)/downloads',
    label: 'Downloads',
    icon: 'download-outline',
    iconActive: 'download',
  },
  {
    key: 'announcements',
    href: '/(tabs)/announcements',
    label: 'Announcements',
    icon: 'megaphone-outline',
    iconActive: 'megaphone',
  },
  { key: 'me', href: '/(tabs)/me', label: 'Me', icon: 'person-outline', iconActive: 'person' },
] as const;

/**
 * iOS 5-tab bar + Android 5-item M3 nav bar — the same five destinations, just two
 * different chromes (design spec §2, plan W3.4).
 */
export const PHONE_NAV_KEYS: readonly NavRouteKey[] = ['home', 'browse', 'search', 'downloads', 'me'] as const;

/**
 * Tablet rail — six destinations, not a re-skin of the phone set. `series` and
 * `announcements` have no phone equivalent by design (planner resolution P3: the rail
 * has room the phone tab bar doesn't; not a gap to fix on phone). `me` is reached via
 * the rail's avatar row instead of a dedicated item (design spec §2), so it's
 * intentionally absent here.
 */
export const TABLET_RAIL_KEYS: readonly NavRouteKey[] = [
  'home',
  'series',
  'browse',
  'search',
  'downloads',
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
