import { sermonMetaLine } from '../meta';
import type { SermonDetail } from '../isPlayable';

const base = {
  published_at: '2026-09-04T12:00:00Z',
  category_name: 'Teaching',
} as unknown as SermonDetail;

describe('sermonMetaLine', () => {
  it('joins the published year (no "published" keyword, no month/day) and category', () => {
    expect(sermonMetaLine(base)).toBe('2026 · Teaching');
  });

  it('omits the category segment when there is none', () => {
    expect(sermonMetaLine({ ...base, category_name: null })).toBe('2026');
  });

  it('omits the year segment when there is none, keeping the category', () => {
    expect(sermonMetaLine({ ...base, published_at: null })).toBe('Teaching');
  });

  it('is an empty string when neither is present', () => {
    expect(sermonMetaLine({ ...base, published_at: null, category_name: null })).toBe('');
  });
});
