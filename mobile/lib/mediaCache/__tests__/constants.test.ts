import {
  FILL_PROGRESS_MAX,
  FILL_PROGRESS_MIN,
  FREE_SPACE_FLOOR_BYTES,
  HARD_CEILING_BYTES,
  MAX_ITEM_QUOTA_FRACTION,
  QUOTA_FRACTION,
  STREAM_EXPIRY_MARGIN_MS,
} from '../constants';

describe('media cache constants', () => {
  it('matches the locked decisions', () => {
    expect([FILL_PROGRESS_MIN, FILL_PROGRESS_MAX]).toEqual([0.05, 0.9]);
    expect(HARD_CEILING_BYTES).toBe(2 * 1024 ** 3);
    expect(FREE_SPACE_FLOOR_BYTES).toBe(1.5 * 1024 ** 3);
    expect(QUOTA_FRACTION).toBe(0.1);
    expect(MAX_ITEM_QUOTA_FRACTION).toBe(0.5);
    expect(STREAM_EXPIRY_MARGIN_MS).toBe(5 * 60 * 1000);
  });
});
