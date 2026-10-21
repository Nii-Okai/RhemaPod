import { buildSeriesWalk, MAX_FLAMES } from '../seriesWalk';
import { isNewRelease } from '../shelfCards';
import type { ContinueWatchingItem } from '../../../../../lib/query/hooks/useContinueWatching';
import type { SeriesEpisode } from '../../../../../lib/query/hooks/useSeries';
import type { ProgressPublic } from '../../../../../lib/query/hooks/useWatchHistory';

function episode(n: number): SeriesEpisode {
  return { id: `e${n}`, title: `Part ${n}`, episode_number: n } as SeriesEpisode;
}

function inProgress(id: string, overrides: Partial<ContinueWatchingItem> = {}): ContinueWatchingItem {
  return {
    id,
    title: 'Divine Patterns · Part 2',
    series_id: 'se1',
    series_title: 'Divine Patterns',
    episode_number: 2,
    duration_seconds: 5400,
    position_seconds: 960,
    ...overrides,
  } as ContinueWatchingItem;
}

function done(sermonId: string): ProgressPublic {
  return { sermon_id: sermonId, completed: true } as ProgressPublic;
}

describe('buildSeriesWalk', () => {
  it('fills finished episodes, marks the one in progress, and leaves the rest ahead', () => {
    const walk = buildSeriesWalk(inProgress('e2'), [1, 2, 3, 4].map(episode), [done('e1')]);
    expect(walk?.steps.map((s) => s.state)).toEqual(['done', 'current', 'ahead', 'ahead']);
    expect(walk?.steps.map((s) => s.label)).toEqual(['PT 1', 'PT 2', 'PT 3', 'PT 4']);
    expect(walk).toMatchObject({ seriesId: 'se1', seriesTitle: 'Divine Patterns', position: 2, total: 4, doneCount: 1 });
    expect(walk?.remaining).toBe('1:14:00');
  });

  it('returns null when the in-progress episode is no longer among the published ones', () => {
    expect(buildSeriesWalk(inProgress('gone'), [1, 2].map(episode), [])).toBeNull();
  });

  it('windows a long series around the current episode', () => {
    const episodes = Array.from({ length: 30 }, (_, i) => episode(i + 1));
    const walk = buildSeriesWalk(inProgress('e20', { episode_number: 20 }), episodes, []);
    expect(walk?.steps).toHaveLength(MAX_FLAMES);
    expect(walk?.steps.some((s) => s.id === 'e20' && s.state === 'current')).toBe(true);
    expect(walk?.total).toBe(30);
  });

  it('has no time left to show when the duration is unknown', () => {
    expect(buildSeriesWalk(inProgress('e1', { duration_seconds: null }), [episode(1)], [])?.remaining).toBeNull();
  });
});

describe('isNewRelease', () => {
  const now = Date.parse('2026-10-21T12:00:00Z');
  it('is new for its first seven days only', () => {
    expect(isNewRelease('2026-10-19T12:00:00Z', now)).toBe(true);
    expect(isNewRelease('2026-10-10T12:00:00Z', now)).toBe(false);
    expect(isNewRelease(null, now)).toBe(false);
  });
});
