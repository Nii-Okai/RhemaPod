import {
  NAV_ROUTES,
  PHONE_NAV_KEYS,
  TABLET_RAIL_KEYS,
  isRouteActive,
  pathnameFor,
  routeByKey,
} from '../routes';

describe('NAV_ROUTES — the single route tree (plan L15/§A.7)', () => {
  it('defines exactly one entry per logical destination', () => {
    const keys = NAV_ROUTES.map((route) => route.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('gives every destination exactly one href — no per-platform path variant', () => {
    const hrefs = NAV_ROUTES.map((route) => route.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it('resolves every phone- and tablet-visible key back to a registered route', () => {
    for (const key of [...PHONE_NAV_KEYS, ...TABLET_RAIL_KEYS]) {
      expect(() => routeByKey(key)).not.toThrow();
    }
  });

  it('throws for an unregistered key rather than silently returning nothing', () => {
    // @ts-expect-error deliberately invalid key, proving the failure mode
    expect(() => routeByKey('bogus')).toThrow('Unknown nav route key');
  });
});

describe('PHONE_NAV_KEYS — iOS + Android phone bar (P1)', () => {
  it('is the same four destinations, labeled "Library" everywhere, never "Saved"', () => {
    expect(PHONE_NAV_KEYS).toEqual(['home', 'browse', 'library', 'me']);
    expect(routeByKey('library').label).toBe('Library');
    expect(NAV_ROUTES.some((route) => route.label === 'Saved')).toBe(false);
  });

  it('has no dedicated Search destination — Browse absorbed it as a pushed screen', () => {
    const keys: string[] = NAV_ROUTES.map((route) => route.key);
    expect(keys).not.toContain('search');
  });
});

describe('TABLET_RAIL_KEYS — the five-destination rail (P3)', () => {
  it('adds series and announcements, which have no phone equivalent by design', () => {
    expect(TABLET_RAIL_KEYS).toEqual(
      expect.arrayContaining(['home', 'series', 'browse', 'library', 'announcements']),
    );
    expect(PHONE_NAV_KEYS).not.toContain('series');
    expect(PHONE_NAV_KEYS).not.toContain('announcements');
  });

  it('omits "me" — reached via the rail avatar row instead of a dedicated item', () => {
    expect(TABLET_RAIL_KEYS).not.toContain('me');
  });
});

describe('isRouteActive', () => {
  const home = routeByKey('home');

  it('matches the route itself and nested sub-routes', () => {
    expect(isRouteActive('/home', home)).toBe(true);
    expect(isRouteActive('/home/detail', home)).toBe(true);
  });

  it('does not match a sibling route that merely shares a text prefix', () => {
    expect(isRouteActive('/homepage', home)).toBe(false);
    expect(isRouteActive('/browse', home)).toBe(false);
  });
});

describe('pathnameFor', () => {
  it('strips the (tabs) route group so it lines up with usePathname()', () => {
    expect(pathnameFor(routeByKey('home'))).toBe('/home');
    expect(pathnameFor(routeByKey('library'))).toBe('/library');
  });
});
