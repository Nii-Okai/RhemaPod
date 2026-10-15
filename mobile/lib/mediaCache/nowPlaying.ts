/**
 * The single "don't evict this" pin (plan D16, S4/S5). `useCachedSource` sets it while a
 * cache hit is actually mounted in the player and clears it on unmount; `evict.ts` (S5)
 * consults it so the file currently playing is never removed out from under playback.
 * Module-level by design — there is exactly one player on screen at a time.
 */
let nowPlayingMediaRefId: string | null = null;

export function setNowPlaying(mediaRefId: string | null): void {
  nowPlayingMediaRefId = mediaRefId;
}

export function getNowPlaying(): string | null {
  return nowPlayingMediaRefId;
}
