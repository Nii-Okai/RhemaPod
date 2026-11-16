import * as session from '../lib/auth/session';
import { resolveIncomingLink } from '../lib/linking/allowList';
import { stashPendingLink } from '../lib/linking/pendingLink';

/**
 * Expo Router's hook for every URL the OS hands the app (Universal/App Links and the
 * `rhemapod://` scheme). `resolveIncomingLink` is the allow-list; anything that isn't
 * shared content or a preserved non-content use goes home.
 *
 * Shared content is never navigated to from here when the app can't show it yet: signed
 * out (or still bootstrapping), or a cold start. Those links are stashed and the user
 * lands on `/` (-> home or sign-in); `useAuthGuard` replays the stash once the signed-in
 * user is on home, so Back from the target returns to home, not out of the app.
 */
export function redirectSystemPath({ path, initial }: { path: string; initial: boolean }): string {
  const resolved = resolveIncomingLink(path);
  switch (resolved.kind) {
    case 'content':
      if (initial || session.getStatus() !== 'signedIn') {
        stashPendingLink(resolved.route);
        return '/';
      }
      return resolved.route;
    case 'passthrough':
      return resolved.path;
    default:
      return '/';
  }
}
