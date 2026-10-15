import { computeQuota, isBelowFreeSpaceFloor, isTooLargeForQuota } from '../quota';
import { HARD_CEILING_BYTES, FREE_SPACE_FLOOR_BYTES, QUOTA_FRACTION, MAX_ITEM_QUOTA_FRACTION } from '../constants';

/**
 * Tested against the real constants with arithmetically-derived boundary inputs, rather
 * than an injected/overridable constants mechanism — `computeQuota` is pure arithmetic
 * over plain numbers, so a boundary like "the ceiling wins" is reachable just by picking
 * a large-enough `freeBytes` literal; no dependency-injection redesign buys anything here.
 */
describe('computeQuota', () => {
  it('the 10% branch wins when the ceiling is larger', () => {
    const free = 1_000_000_000; // 1GB
    const cache = 0;
    const expected = (free + cache) * QUOTA_FRACTION;
    expect(expected).toBeLessThan(HARD_CEILING_BYTES);
    expect(computeQuota(free, cache)).toBe(expected);
  });

  it('the ceiling wins when free is large', () => {
    const free = HARD_CEILING_BYTES / QUOTA_FRACTION + 1; // just past the point where 10% exceeds the ceiling
    expect(computeQuota(free, 0)).toBe(HARD_CEILING_BYTES);
  });

  it('feedback-loop invariant: quota is identical before and after a fill moves bytes from free to cache', () => {
    const totalBefore = { free: 5_000_000_000, cache: 100_000_000 };
    const totalAfter = { free: totalBefore.free - 10_000_000, cache: totalBefore.cache + 10_000_000 }; // a 10MB fill
    expect(computeQuota(totalBefore.free, totalBefore.cache)).toBe(computeQuota(totalAfter.free, totalAfter.cache));
  });

  it('zero and negative free-space input are clamped, never throw, never go negative', () => {
    expect(() => computeQuota(0, 0)).not.toThrow();
    expect(computeQuota(0, 0)).toBe(0);
    expect(() => computeQuota(-1, -1)).not.toThrow();
    expect(computeQuota(-1, -1)).toBe(0);
  });

  it('negative cache bytes are clamped too, not subtracted', () => {
    expect(computeQuota(1_000_000_000, -500)).toBe(computeQuota(1_000_000_000, 0));
  });
});

describe('isBelowFreeSpaceFloor', () => {
  it('true below the floor, false at and above it', () => {
    expect(isBelowFreeSpaceFloor(FREE_SPACE_FLOOR_BYTES - 1)).toBe(true);
    expect(isBelowFreeSpaceFloor(FREE_SPACE_FLOOR_BYTES)).toBe(false);
    expect(isBelowFreeSpaceFloor(FREE_SPACE_FLOOR_BYTES + 1)).toBe(false);
  });
});

describe('isTooLargeForQuota', () => {
  const quota = 1_000_000; // 1MB, arbitrary round number

  it('exactly 50% of quota is allowed', () => {
    expect(isTooLargeForQuota(quota * MAX_ITEM_QUOTA_FRACTION, quota)).toBe(false);
  });

  it('50% of quota plus one byte is too large', () => {
    expect(isTooLargeForQuota(quota * MAX_ITEM_QUOTA_FRACTION + 1, quota)).toBe(true);
  });

  it('well under the threshold is allowed', () => {
    expect(isTooLargeForQuota(1, quota)).toBe(false);
  });
});
