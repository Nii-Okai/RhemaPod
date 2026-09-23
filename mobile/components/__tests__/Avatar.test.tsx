import { hashToIndex, initialsFrom } from '../Avatar';

describe('initialsFrom', () => {
  it('takes first+last initials for a multi-word name', () => {
    expect(initialsFrom('Ada Nwosu')).toBe('AN');
  });

  it('falls back to "?" for an empty/whitespace-only name', () => {
    expect(initialsFrom('   ')).toBe('?');
  });
});

describe('hashToIndex', () => {
  it('is deterministic for the same seed', () => {
    expect(hashToIndex('speaker-42', 3)).toBe(hashToIndex('speaker-42', 3));
  });

  it('always stays within the bucket range, including for an empty seed', () => {
    for (const seed of ['', 'a', 'a much longer seed string than usual']) {
      const index = hashToIndex(seed, 3);
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(3);
    }
  });
});
