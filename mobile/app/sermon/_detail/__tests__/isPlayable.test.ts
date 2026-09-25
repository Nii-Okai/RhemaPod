import { isPlayable, type SermonDetail } from '../isPlayable';

const base = {
  locked: false,
  media_refs: [{ id: 'm1', type: 'video', quality: null, s3_key: 'x', hls_manifest_key: null }],
} as unknown as SermonDetail;

describe('isPlayable', () => {
  it('is true when unlocked and at least one media ref exists', () => {
    expect(isPlayable(base)).toBe(true);
  });

  it('is false when media_refs is empty (no-media state, §8.3)', () => {
    expect(isPlayable({ ...base, media_refs: [] })).toBe(false);
  });

  it('is false when locked, even with media present (interim decision, W4.1)', () => {
    expect(isPlayable({ ...base, locked: true })).toBe(false);
  });
});
