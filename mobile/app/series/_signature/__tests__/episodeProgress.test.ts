import { ctaWording, episodeProgress, partName, pickRelated, sharedSpeaker } from '../episodeProgress';
import type { SeriesEpisode } from '../../../../lib/query/hooks/useSeries';
import type { ProgressPublic } from '../../../../lib/query/hooks/useWatchHistory';

const episode = (overrides: Partial<SeriesEpisode>): SeriesEpisode =>
  ({ id: 'e', title: 'Part', duration_seconds: 5400, episode_number: 1, speaker_name: null, ...overrides }) as SeriesEpisode;

const progress = (overrides: Partial<ProgressPublic>): ProgressPublic =>
  ({
    sermon_id: 'e',
    position_seconds: 0,
    watched_seconds: 0,
    completed: false,
    play_count: 1,
    last_played_at: '2026-10-01T00:00:00Z',
    ...overrides,
  }) as ProgressPublic;

describe('episodeProgress', () => {
  it('marks a finished episode watched, with a full bar', () => {
    expect(episodeProgress(episode({}), progress({ completed: true, position_seconds: 5400 }))).toEqual({
      state: 'done',
      fraction: 1,
      meta: '1:30:00 · WATCHED',
    });
  });

  it('shows the time left and how far in for a started episode', () => {
    expect(episodeProgress(episode({}), progress({ position_seconds: 2700 }))).toEqual({
      state: 'started',
      fraction: 0.5,
      meta: '1:30:00 · 45:00 LEFT',
    });
  });

  it('shows only the duration for an unplayed episode', () => {
    expect(episodeProgress(episode({}), undefined)).toEqual({ state: 'ahead', fraction: 0, meta: '1:30:00' });
  });

  it('draws no bar or time left when the duration is unknown', () => {
    expect(episodeProgress(episode({ duration_seconds: null }), progress({ position_seconds: 60 }))).toEqual({
      state: 'started',
      fraction: 0,
      meta: '',
    });
  });
});

describe('ctaWording', () => {
  const base = { accessibilityLabel: '', episodeId: 'e2', episodeTitle: 'Bonus' };

  it('names the part and the time left when resuming', () => {
    expect(ctaWording({ ...base, label: 'Resume', secondaryReadout: '0:41' }, episode({ episode_number: 2 }))).toEqual({
      label: 'Resume Part 2',
      readout: '0:41 LEFT',
    });
  });

  it('falls back to the title for an unnumbered episode', () => {
    const bonus = episode({ title: 'Bonus', episode_number: null });
    expect(ctaWording({ ...base, label: 'Play', secondaryReadout: '15:00' }, bonus)).toEqual({
      label: 'Play Bonus',
      readout: '15:00',
    });
    expect(partName(bonus)).toBe('Bonus');
  });

  it('says "Play again" once everything is watched', () => {
    expect(ctaWording({ ...base, label: 'Play Again', secondaryReadout: null }, episode({}))).toEqual({
      label: 'Play again',
      readout: null,
    });
  });
});

describe('sharedSpeaker', () => {
  it('returns the one speaker the episodes share, ignoring blanks', () => {
    const episodes = [episode({ speaker_name: 'Ada' }), episode({ speaker_name: null }), episode({ speaker_name: 'Ada' })];
    expect(sharedSpeaker(episodes)).toBe('Ada');
  });

  it('returns nothing when the episodes name more than one speaker, or none', () => {
    expect(sharedSpeaker([episode({ speaker_name: 'Ada' }), episode({ speaker_name: 'Grace' })])).toBeNull();
    expect(sharedSpeaker([episode({})])).toBeNull();
  });
});

describe('pickRelated', () => {
  it("drops this series' episodes and keeps one episode per other series", () => {
    const results = [
      { id: 'a', series_id: 's1' },
      { id: 'b', series_id: 's2' },
      { id: 'c', series_id: 's2' },
      { id: 'd', series_id: null },
      { id: 'e', series_id: null },
    ];
    expect(pickRelated(results, 's1').map((r) => r.id)).toEqual(['b', 'd', 'e']);
  });
});
