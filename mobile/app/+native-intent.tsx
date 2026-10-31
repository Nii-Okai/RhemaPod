import { resolveIncomingLink } from '../lib/linking/allowList';

/**
 * Expo Router's hook for every URL the OS hands the app (Universal/App Links and the
 * `rhemapod://` scheme). `resolveIncomingLink` is the allow-list; anything that isn't
 * shared content or a preserved non-content use goes home.
 */
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  const resolved = resolveIncomingLink(path);
  switch (resolved.kind) {
    case 'content':
      return resolved.route;
    case 'passthrough':
      return resolved.path;
    default:
      return '/';
  }
}
