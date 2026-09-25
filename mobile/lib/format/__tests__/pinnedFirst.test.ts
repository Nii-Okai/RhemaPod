import { sortPinnedFirst } from '../pinnedFirst';

describe('sortPinnedFirst', () => {
  it('moves pinned items ahead of unpinned ones', () => {
    const items = [
      { id: 'a', pinned: false },
      { id: 'b', pinned: true },
      { id: 'c', pinned: false },
    ];
    expect(sortPinnedFirst(items).map((i) => i.id)).toEqual(['b', 'a', 'c']);
  });

  it('is a stable sort — preserves relative order within each pinned group', () => {
    const items = [
      { id: 'a', pinned: true },
      { id: 'b', pinned: false },
      { id: 'c', pinned: true },
      { id: 'd', pinned: false },
    ];
    expect(sortPinnedFirst(items).map((i) => i.id)).toEqual(['a', 'c', 'b', 'd']);
  });

  it('is a no-op when the server already returned pinned-first order', () => {
    const items = [
      { id: 'a', pinned: true },
      { id: 'b', pinned: false },
    ];
    expect(sortPinnedFirst(items)).toEqual(items);
  });

  it('does not mutate the input array', () => {
    const items = [
      { id: 'a', pinned: false },
      { id: 'b', pinned: true },
    ];
    const copy = [...items];
    sortPinnedFirst(items);
    expect(items).toEqual(copy);
  });
});
