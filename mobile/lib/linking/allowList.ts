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
 * - Google Sign-In's iOS callback (`com.googleusercontent.apps.<id>:/oauthredirect`), which
 *   the native SDK consumes itself — rewriting it to `/` would reset the sign-in screen
 *   mid-flow.
 * - expo-dev-client's launcher links (`rhemapod://expo-development-client/...`,
 *   `exp+rhemapod-mobile://...`), which only exist in development builds.
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
const GOOGLE_CALLBACK_SCHEME = /^com\.googleusercontent\.apps\./i;
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
    if (/^\/expo-development-client(\/|\?|$)/.test(path)) return { kind: 'passthrough', path: input };
    return contentRoute(path);
  }

  if (scheme === DEV_CLIENT_SCHEME || GOOGLE_CALLBACK_SCHEME.test(scheme)) {
    return { kind: 'passthrough', path: input };
  }

  return HOME;
}
