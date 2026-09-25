import { buildHistoryMap, deriveEpisodeStatus } from '../episodeStatus';
import type { ProgressPublic } from '../../query/hooks/useWatchHistory';

function progress(overrides: Partial<ProgressPublic> = {}): ProgressPublic {
  return {
    sermon_id: 'sermon-1',
    position_seconds: 600,
    watched_seconds: 600,
    completed: false,
    play_count: 1,
    last_played_at: '2026-09-01T00:00:00Z',
    ...overrides,
  };
}

describe('buildHistoryMap', () => {
  it('keys by sermon_id', () => {
    const map = buildHistoryMap([progress({ sermon_id: 'a' }), progress({ sermon_id: 'b' })]);
    expect(map.size).toBe(2);
    expect(map.get('a')?.sermon_id).toBe('a');
  });
});

describe('deriveEpisodeStatus', () => {
  it('returns "new" when the episode has no history row', () => {
    const map = buildHistoryMap([]);
    expect(deriveEpisodeStatus({ id: 'ep-1', duration_seconds: 1000 }, map)).toBe('new');
  });

  it('returns "watched" for a completed history row, regardless of duration data', () => {
    const map = buildHistoryMap([progress({ sermon_id: 'ep-1', completed: true })]);
    expect(deriveEpisodeStatus({ id: 'ep-1', duration_seconds: null }, map)).toBe('watched');
  });

  it('returns "<remaining> left" for an in-progress row with a known duration', () => {
    const map = buildHistoryMap([progress({ sermon_id: 'ep-1', position_seconds: 1024, completed: false })]);
    // 2538s total (Anchored in the Storm's own runtime, matches other fixtures in this repo) - 1024s watched = 1514s = 25:14
    expect(deriveEpisodeStatus({ id: 'ep-1', duration_seconds: 2538 }, map)).toBe('25:14 left');
  });

  it('never reports negative remaining time when position exceeds duration (clock skew/rounding)', () => {
    const map = buildHistoryMap([progress({ sermon_id: 'ep-1', position_seconds: 500, completed: false })]);
    expect(deriveEpisodeStatus({ id: 'ep-1', duration_seconds: 400 }, map)).toBe('0:00 left');
  });

  it('falls back to "in progress" (not a fabricated time) when duration is not yet known', () => {
    const map = buildHistoryMap([progress({ sermon_id: 'ep-1', completed: false })]);
    expect(deriveEpisodeStatus({ id: 'ep-1', duration_seconds: null }, map)).toBe('in progress');
  });
});
