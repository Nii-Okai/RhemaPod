import { buildHistoryMap } from '../episodeStatus';
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
