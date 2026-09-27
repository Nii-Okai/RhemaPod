import { buildSermonTitleMap } from '../sermonTitleMap';

describe('buildSermonTitleMap', () => {
  it('keys the catalog by sermon id', () => {
    const sermons = [
      { id: 's1', title: 'First Sermon' },
      { id: 's2', title: 'Second Sermon' },
    ] as never;
    const map = buildSermonTitleMap(sermons);
    expect(map.get('s1')?.title).toBe('First Sermon');
    expect(map.get('s2')?.title).toBe('Second Sermon');
  });

  it('returns an empty map for an empty catalog, with no lookups matching', () => {
    const map = buildSermonTitleMap([]);
    expect(map.size).toBe(0);
    expect(map.get('missing')).toBeUndefined();
  });
});
