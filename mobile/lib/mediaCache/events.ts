/* global __DEV__, console */
/**
 * `__DEV__`-only observability for the media cache (plan P7). Carries the event name,
 * `sermonId` and `MediaRef.id` only — never a URL, query string or token (D12). A no-op
 * in release builds, so on-device checks observe hit/miss in dev clients only.
 */

/**
 * A closed union, not a `fill-skip:${string}` template literal (S9 review, N4): an open
 * template accepts any string a future caller writes, including a URL fragment pasted in
 * by mistake — defeating D12 ("never a URL, query string or token") silently at the type
 * level. Every reason actually in use is named explicitly instead.
 */
export type FillSkipReason = 'signed-out' | 'already-in-flight' | 'expired' | 'network' | 'disk-floor';

export type CacheEventName =
  | 'hit'
  | 'miss'
  | 'fill-start'
  | 'fill-commit'
  | `fill-skip:${FillSkipReason}`
  | 'evict'
  | 'sweep'
  | 'wipe';

export interface CacheEventIds {
  sermonId?: string;
  mediaRefId?: string;
}

export function emitCacheEvent(name: CacheEventName, ids: CacheEventIds = {}): void {
  if (!__DEV__) return;
  console.info('[mediaCache]', name, { sermonId: ids.sermonId, mediaRefId: ids.mediaRefId });
}
