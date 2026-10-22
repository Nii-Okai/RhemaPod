import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as FileSystem from 'expo-file-system';
import * as manifest from './manifest';
import * as paths from './paths';
import * as nowPlaying from './nowPlaying';
import { requestFill } from './fill';
import { ensureSwept } from './sweep';
import { cacheKeyFor, type CacheKey, type KeyMediaRef, type KeyVariant } from './key';
import { emitCacheEvent } from './events';
import { FILL_PROGRESS_MIN, FILL_PROGRESS_MAX } from './constants';

/**
 * The player's hook into the media cache (plan S4). Used on the streaming path only
 * (`!isDownloaded`) — the Downloads path (`useLocalPlayback`) never touches this at all.
 *
 * `/stream` having already succeeded is the caller's responsibility: this hook is only
 * ever constructed with a `variant` once `streamQuery.data` exists, so an entitlement
 * failure or network error always resolves to the existing error UI upstream, before a
 * local file ever becomes reachable (D11 — a cache hit never bypasses `/stream`).
 */

export interface CachedSourceDeps {
  manifestGet: typeof manifest.get;
  manifestTouch: typeof manifest.touch;
  manifestDeleteByKey: typeof manifest.deleteByKey;
  getFileInfo: (uri: string) => Promise<{ exists: boolean; size: number }>;
  requestFill: (request: Parameters<typeof requestFill>[0]) => ReturnType<typeof requestFill>;
  setNowPlaying: typeof nowPlaying.setNowPlaying;
  ensureSwept: typeof ensureSwept;
  now: () => number;
}

async function realGetFileInfo(uri: string): Promise<{ exists: boolean; size: number }> {
  const info = await FileSystem.getInfoAsync(uri, { size: true });
  return { exists: info.exists, size: info.exists && !info.isDirectory ? (info.size ?? 0) : 0 };
}

function defaultDeps(): CachedSourceDeps {
  return {
    manifestGet: manifest.get,
    manifestTouch: manifest.touch,
    manifestDeleteByKey: manifest.deleteByKey,
    getFileInfo: realGetFileInfo,
    requestFill: (request) => requestFill(request),
    setNowPlaying: nowPlaying.setNowPlaying,
    ensureSwept,
    now: () => Date.now(),
  };
}

export interface UseCachedSourceArgs {
  sermonId: string;
  /** `SermonDetail.media_refs`, structurally — only `id`/`type` are read. */
  mediaRefs: readonly KeyMediaRef[];
  /** The stream variant the player would otherwise use untouched. `null` while the
   * stream/detail reads haven't resolved yet (the hook is simply inert then). */
  variant: KeyVariant | null;
  /** `false` for a downloaded sermon, or whenever the stream path isn't in play. */
  enabled: boolean;
  /** Epoch ms the current `/stream` URL expires — `null` if not yet known. */
  expiresAt: number | null;
}

export interface UseCachedSourceResult {
  /** True only while a cacheable key's manifest lookup is in flight — joins the
   * player's own loading gate so a hit's local URI is known before first mount. */
  isLoading: boolean;
  /** The URI the player should actually use: the local cache file on a hit, the
   * original stream URL on a miss or an uncacheable variant, `null` while loading. */
  effectiveUrl: string | null;
  /** Call once, with the final playback position/duration, when the player is about to
   * leave this sermon (P1: the route's `id` changes, or the screen unmounts — never a
   * mere app-background). A no-op on a hit, an uncacheable variant, or a disabled hook. */
  reportExit: (positionSeconds: number, durationSeconds: number | null) => void;
}

interface LookupState {
  /** The key this state describes — a state for an older key (or none) means the lookup
   * for the current key hasn't started yet, which counts as loading. */
  forKey: string | null;
  loading: boolean;
  hit: boolean;
  localUrl: string | null;
}

export function useCachedSource(
  { sermonId, mediaRefs, variant, enabled, expiresAt }: UseCachedSourceArgs,
  deps: CachedSourceDeps = defaultDeps(),
): UseCachedSourceResult {
  const key: CacheKey | null = useMemo(
    () => (enabled && variant ? cacheKeyFor(mediaRefs, variant) : null),
    [enabled, variant, mediaRefs],
  );

  const [state, setState] = useState<LookupState>({ forKey: null, loading: false, hit: false, localUrl: null });

  useEffect(() => {
    if (!key) {
      setState({ forKey: null, loading: false, hit: false, localUrl: null });
      return;
    }

    let cancelled = false;
    const forKey = key.mediaRefId;
    setState({ forKey, loading: true, hit: false, localUrl: null });

    void (async () => {
      // Best-effort, once per app launch — `ensureSwept` swallows its own failures, so
      // this never blocks or fails a lookup even if the sweep itself couldn't run.
      await deps.ensureSwept();
      if (cancelled) return;

      const entry = await deps.manifestGet(key.mediaRefId);
      if (!entry) {
        if (!cancelled) {
          emitCacheEvent('miss', { sermonId, mediaRefId: key.mediaRefId });
          setState({ forKey, loading: false, hit: false, localUrl: null });
        }
        return;
      }

      // Gilfoyle (S8 finding 4): pinned *before* the existence check, not after — a fill
      // that commits (and evicts) in the window between finding this row and finishing
      // the check could otherwise remove this exact entry while it was still unprotected,
      // deleting the file out from under a lookup that was about to play it. Cleared again
      // below if this turns out to be a miss after all (missing/wrong-size file).
      const localUrl = paths.mediaCacheFilePath(entry.fileName);
      deps.setNowPlaying(key.mediaRefId);
      const info = await deps.getFileInfo(localUrl);
      if (cancelled) return;

      if (!info.exists || info.size !== entry.sizeBytes) {
        deps.setNowPlaying(null);
        await deps.manifestDeleteByKey(key.mediaRefId).catch(() => {});
        if (cancelled) return;
        emitCacheEvent('miss', { sermonId, mediaRefId: key.mediaRefId });
        setState({ forKey, loading: false, hit: false, localUrl: null });
        return;
      }

      await deps.manifestTouch(key.mediaRefId, deps.now());
      if (cancelled) return;
      emitCacheEvent('hit', { sermonId, mediaRefId: key.mediaRefId });
      setState({ forKey, loading: false, hit: true, localUrl });
    })();

    return () => {
      cancelled = true;
      deps.setNowPlaying(null);
    };
    // Deliberately `[key?.mediaRefId, sermonId]` only — `deps` is a stable default
    // singleton in production and the tests' own fixed object, so this effect should NOT
    // re-run on every render. (No `react-hooks/exhaustive-deps` rule is installed in this
    // project to suppress here, same as `[id].tsx`'s own `[status]`-only effect.)
  }, [key?.mediaRefId, sermonId]);

  const lookupPending = Boolean(key) && (state.forKey !== key?.mediaRefId || state.loading);

  const reportExit = useCallback(
    (positionSeconds: number, durationSeconds: number | null) => {
      if (!key || !variant || state.hit || lookupPending) return;
      if (expiresAt === null) return;
      if (!durationSeconds || durationSeconds <= 0 || !Number.isFinite(durationSeconds)) return;
      const fraction = positionSeconds / durationSeconds;
      if (fraction < FILL_PROGRESS_MIN || fraction > FILL_PROGRESS_MAX) return;
      void deps.requestFill({ sermonId, key, url: variant.url, expiresAt });
    },
    [key, variant, state.hit, lookupPending, expiresAt, sermonId, deps],
  );

  const resolvedUrl = !key ? (variant?.url ?? null) : lookupPending ? null : state.hit ? state.localUrl : (variant?.url ?? null);

  // The first URL this sermon actually resolved to is the one it keeps. A sermon reopened
  // in the same session starts streaming from the still-in-memory /stream response before
  // the fresh fetch lands and lets the cache in (`[id].tsx`'s `isStreamFreshThisMount`);
  // switching then — to a loading gate, the local file, or the refetch's new presigned URL
  // — unmounted and restarted the player mid-play. The lookup still runs, so `reportExit`
  // knows whether a fill is needed; the cached copy is used from the next open.
  const committed = useRef<{ sermonId: string; url: string } | null>(null);
  if (committed.current && committed.current.sermonId !== sermonId) committed.current = null;
  if (!committed.current && resolvedUrl) committed.current = { sermonId, url: resolvedUrl };
  const effectiveUrl = committed.current?.url ?? resolvedUrl;

  return { isLoading: !committed.current && lookupPending, effectiveUrl, reportExit };
}
