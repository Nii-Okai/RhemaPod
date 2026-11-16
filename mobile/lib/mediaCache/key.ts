/**
 * Cache key derivation (plan D9, D12, P3). The key is the server-issued `MediaRef.id`;
 * the on-disk name is `<uuid-lowercase>.<ext>` with the extension from a fixed allow-list
 * keyed by media type. Nothing from the URL (host, path, query) ever reaches the result,
 * so a presigned URL can never leak into a file name or the manifest.
 */

export interface CacheKey {
  mediaRefId: string;
  fileName: string;
}

/** Structural subset of `MediaRefPublic` — only what the key needs. */
export interface KeyMediaRef {
  id: string;
  type: string;
}

/** Structural subset of `StreamVariant` — only what the key needs. */
export interface KeyVariant {
  type: string;
  url: string;
}

const STRICT_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Fixed allow-list: media type -> file extension. Anything else is uncacheable. */
const EXT_BY_TYPE: Readonly<Record<string, string>> = { audio: 'mp3', video: 'mp4' };

function isCacheableUrl(url: string): boolean {
  if (!/^https?:\/\/[^/?#\s]+/i.test(url)) return false;
  const path = url.split(/[?#]/, 1)[0];
  return !path.toLowerCase().endsWith('.m3u8');
}

export function cacheKeyFor(mediaRefs: readonly KeyMediaRef[], selectedVariant: KeyVariant): CacheKey | null {
  if (!isCacheableUrl(selectedVariant.url)) return null;
  const ext = Object.prototype.hasOwnProperty.call(EXT_BY_TYPE, selectedVariant.type)
    ? EXT_BY_TYPE[selectedVariant.type]
    : undefined;
  if (!ext) return null;
  const ref = mediaRefs.find((r) => r.type === selectedVariant.type);
  if (!ref || !STRICT_UUID.test(ref.id)) return null;
  const mediaRefId = ref.id.toLowerCase();
  return { mediaRefId, fileName: `${mediaRefId}.${ext}` };
}
