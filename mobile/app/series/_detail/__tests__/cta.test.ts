import { resolveSeriesCta } from '../cta';
import type { SeriesEpisode } from '../../../../lib/query/hooks/useSeries';
import type { ProgressPublic } from '../../../../lib/query/hooks/useWatchHistory';

function episode(overrides: Partial<SeriesEpisode>): SeriesEpisode {
  return {
    id: 'e1',
    title: 'Episode',
    description: null,
    duration_seconds: 1800,
    episode_number: 1,
    category_id: null,
    category_name: null,
    series_id: 's1',
    series_title: null,
    speaker_id: null,
    speaker_name: null,
    thumbnail_url: null,
    locked: false,
    tier: 'free',
    ...overrides,
  } as SeriesEpisode;
}

function progress(overrides: Partial<ProgressPublic>): ProgressPublic {
  return {
    sermon_id: 'e1',
    position_seconds: 0,
    watched_seconds: 0,
    completed: false,
    play_count: 1,
    last_played_at: '2026-09-01T00:00:00Z',
    ...overrides,
  } as ProgressPublic;
}

describe('resolveSeriesCta', () => {
  it('returns null when the series has no episodes', () => {
    expect(resolveSeriesCta([], new Map())).toBeNull();
  });

  it('Play, targeting the first episode, when nothing has been watched', () => {
    const episodes = [episode({ id: 'e1' }), episode({ id: 'e2' })];
    const cta = resolveSeriesCta(episodes, new Map());
    expect(cta).toMatchObject({ label: 'Play', episodeId: 'e1' });
  });

  it('Resume, targeting the in-progress episode, with remaining time', () => {
    const episodes = [
      episode({ id: 'e1', duration_seconds: 1800 }),
      episode({ id: 'e2', duration_seconds: 900 }),
    ];
    const history = new Map([['e1', progress({ sermon_id: 'e1', position_seconds: 600 })]]);

    const cta = resolveSeriesCta(episodes, history);

    expect(cta).toMatchObject({ label: 'Resume', episodeId: 'e1', secondaryReadout: '20:00' });
  });

  it('skips a completed episode and targets the next unwatched one', () => {
    const episodes = [episode({ id: 'e1' }), episode({ id: 'e2' })];
    const history = new Map([['e1', progress({ sermon_id: 'e1', completed: true, position_seconds: 1800 })]]);

    const cta = resolveSeriesCta(episodes, history);

    expect(cta).toMatchObject({ label: 'Play', episodeId: 'e2' });
  });

  it('a zero position_seconds row (started but not really progressed) does not count as in-progress', () => {
    const episodes = [episode({ id: 'e1' }), episode({ id: 'e2' })];
    const history = new Map([['e1', progress({ sermon_id: 'e1', position_seconds: 0 })]]);

    // e1 has a history row but no real progress — resolveSeriesCta's own "in progress"
    // test requires position_seconds > 0, matching sermon-detail's own Resume gate.
    const cta = resolveSeriesCta(episodes, history);

    expect(cta?.label).not.toBe('Resume');
  });

  it('Play Again, from the first episode, once every episode is completed', () => {
    const episodes = [episode({ id: 'e1' }), episode({ id: 'e2' })];
    const history = new Map([
      ['e1', progress({ sermon_id: 'e1', completed: true })],
      ['e2', progress({ sermon_id: 'e2', completed: true })],
    ]);

    const cta = resolveSeriesCta(episodes, history);

    expect(cta).toMatchObject({ label: 'Play Again', episodeId: 'e1' });
  });

  it('falls back to a plain duration readout (no remaining-time math) when duration_seconds is unknown', () => {
    const episodes = [episode({ id: 'e1', duration_seconds: null })];
    const cta = resolveSeriesCta(episodes, new Map());
    expect(cta?.secondaryReadout).toBeNull();
  });
});
