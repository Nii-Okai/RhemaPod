/* global __DEV__ */
/**
 * Inbound-URL allow-list (ADR 0021, plan-share-links S5), applied by
 * `app/+native-intent.tsx` to every URL the OS hands the app.
 *
 * The only links the app acts on are shared content: `/(sermon|series|playlist)/<uuid>`,
 * arriving either as `https://open.rhemapod.com/...` (Universal/App Link) or as the
 * `rhemapod://...` scheme (old shares, the fallback page's "Open in RhemaPod" button).
 * Everything else lands on home, except the two inbound uses that exist for non-content
 * reasons, which are passed through untouched:
 *
 * - Google Sign-In's iOS callback, only for this app's own client-id scheme and only the
 *   `/oauthredirect` path. The native SDK consumes the URL itself (app-delegate
 *   subscriber), but React Native's Linking also delivers it to the router; rewriting it to
 *   `/` would reset the sign-in screen mid-flow.
 * - expo-dev-client's launcher links (`rhemapod://expo-development-client/...`,
 *   `exp+rhemapod-mobile://...`), only when `__DEV__`; in release they go home.
 *
 * Pure: no router, no session. Stash/replay lives in `pendingLink.ts`.
 */
export const SHARE_HOST = 'open.rhemapod.com';

export type LinkResolution =
  /** A shared-content link: navigate to `route` (signed-in) or stash it (signed-out). */
  | { kind: 'content'; route: string }
  /** A non-content inbound use that must reach the router exactly as received. */
  | { kind: 'passthrough'; path: string }
  /** Anything else. */
  | { kind: 'home' };

const HOME: LinkResolution = { kind: 'home' };

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const CONTENT_PATH = new RegExp(`^/(sermon|series|playlist)/(${UUID})$`, 'i');
const SCHEME_PREFIX = /^([a-z][a-z0-9+.-]*):/i;
// The iOS client's reversed-client-id scheme: the same value `app.json` registers as
// `iosUrlScheme` for the Google Sign-In plugin (so it is the only scheme iOS delivers
// to us for Google). Pinned, not pattern-matched: any other `com.googleusercontent.apps.*`
// scheme is an attacker-registered or foreign link.
export const GOOGLE_CALLBACK_SCHEME =
  'com.googleusercontent.apps.827558560538-ujevidt1217i6a2gu8fm9sn8je755kta';
const GOOGLE_CALLBACK_PATH = /^\/oauthredirect\/?$/i;
const DEV_CLIENT_SCHEME = 'exp+rhemapod-mobile';

function contentRoute(path: string): LinkResolution {
  const withoutSuffix = path.split(/[?#]/, 1)[0] ?? '';
  const trimmed = withoutSuffix.replace(/\/+$/, '');
  const match = CONTENT_PATH.exec(trimmed);
  if (!match) return HOME;
  return { kind: 'content', route: `/${match[1]!.toLowerCase()}/${match[2]!.toLowerCase()}` };
}

export function resolveIncomingLink(raw: string): LinkResolution {
  const input = (raw ?? '').trim();
  if (!input) return HOME;

  const schemeMatch = SCHEME_PREFIX.exec(input);
  // A bare path (`/sermon/<uuid>`) — treated like the scheme form.
  if (!schemeMatch) return contentRoute(input.startsWith('/') ? input : `/${input}`);

  const scheme = schemeMatch[1]!.toLowerCase();
  const rest = input.slice(schemeMatch[0].length);

  if (scheme === 'https') {
    // `//host[:port]/path` — an explicit port or userinfo is never the share host.
    const m = /^\/\/([^/?#]*)(.*)$/.exec(rest);
    if (!m || m[1]!.toLowerCase() !== SHARE_HOST) return HOME;
    return contentRoute(m[2] || '/');
  }

  if (scheme === 'rhemapod') {
    // `rhemapod://sermon/<uuid>` has "sermon" in the authority slot; strip the slashes
    // and read the whole remainder as the path.
    const path = `/${rest.replace(/^\/+/, '')}`;
    if (__DEV__ && /^\/expo-development-client(\/|\?|$)/.test(path)) {
      return { kind: 'passthrough', path: input };
    }
    return contentRoute(path);
  }

  // Dev-client launcher links exist only in development builds; in release they are home.
  if (scheme === DEV_CLIENT_SCHEME) return __DEV__ ? { kind: 'passthrough', path: input } : HOME;

  if (scheme === GOOGLE_CALLBACK_SCHEME) {
    const pathOnly = rest.replace(/^\/+/, '/').split(/[?#]/, 1)[0] ?? '';
    return GOOGLE_CALLBACK_PATH.test(pathOnly) ? { kind: 'passthrough', path: input } : HOME;
  }

  return HOME;
}
