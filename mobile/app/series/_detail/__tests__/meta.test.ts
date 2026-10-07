import { episodeCountLabel, seriesMetaLine } from '../meta';

describe('episodeCountLabel', () => {
  it('singularizes exactly one episode', () => {
    expect(episodeCountLabel(1)).toBe('1 episode');
  });

  it('pluralizes any other count', () => {
    expect(episodeCountLabel(0)).toBe('0 episodes');
    expect(episodeCountLabel(4)).toBe('4 episodes');
  });
});

describe('seriesMetaLine', () => {
  it('joins episode count and category', () => {
    expect(seriesMetaLine({ episode_count: 4, category_name: 'Faith' })).toBe('4 episodes · Faith');
  });

  it('drops the category segment entirely when uncategorised, never "· "', () => {
    expect(seriesMetaLine({ episode_count: 4, category_name: null })).toBe('4 episodes');
  });
});
