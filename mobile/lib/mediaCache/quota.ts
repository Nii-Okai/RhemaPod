import { HARD_CEILING_BYTES, FREE_SPACE_FLOOR_BYTES, QUOTA_FRACTION, MAX_ITEM_QUOTA_FRACTION } from './constants';

/**
 * The D15 quota formula (plan S5), pure and injected-free-space so it never touches the
 * filesystem itself. Counting the cache's own bytes back into "available" space is
 * deliberate: a fill moves bytes from `free` to `cache`, not out of the device — without
 * this, cache growth would shrink its own quota (free shrinks, quota shrinks, eviction
 * fires again, free grows back a little, repeat).
 */
export function computeQuota(freeBytes: number, cacheBytes: number): number {
  const total = Math.max(0, freeBytes) + Math.max(0, cacheBytes);
  return Math.min(HARD_CEILING_BYTES, total * QUOTA_FRACTION);
}

/** D15's absolute reserve: never fill (or keep filling) once free space would drop below this. */
export function isBelowFreeSpaceFloor(freeBytes: number): boolean {
  return freeBytes < FREE_SPACE_FLOOR_BYTES;
}

/** D15's per-item cap: don't bother caching something that would immediately blow the budget. */
export function isTooLargeForQuota(itemSizeBytes: number, quotaBytes: number): boolean {
  return itemSizeBytes > quotaBytes * MAX_ITEM_QUOTA_FRACTION;
}
