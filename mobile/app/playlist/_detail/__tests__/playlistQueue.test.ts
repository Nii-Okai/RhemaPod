import { playlistQueueParams, shuffled } from '../playlistQueue';

describe('playlistQueueParams', () => {
  it('returns null for an empty playlist — nothing to play', () => {
    expect(playlistQueueParams('p1', [])).toBeNull();
  });

  it('joins ids into one comma-separated queue, starting at index 0 by default', () => {
    expect(playlistQueueParams('p1', ['a', 'b', 'c'])).toEqual({
      id: 'a',
      playlistId: 'p1',
      queue: 'a,b,c',
      queueIndex: '0',
    });
  });

  it('honors a non-zero start index', () => {
    expect(playlistQueueParams('p1', ['a', 'b', 'c'], 2)).toEqual({
      id: 'c',
      playlistId: 'p1',
      queue: 'a,b,c',
      queueIndex: '2',
    });
  });
});

describe('shuffled', () => {
  it('returns every item exactly once, without mutating the input', () => {
    const original = ['a', 'b', 'c', 'd'];
    const result = shuffled(original);

    expect(result.slice().sort()).toEqual(original.slice().sort());
    expect(original).toEqual(['a', 'b', 'c', 'd']);
  });
});
