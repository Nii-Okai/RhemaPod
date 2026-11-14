import { queueStore } from '../../../../lib/playback/queue';
import { shuffled, startPlaylistQueue } from '../playlistQueue';

const row = (id: string) =>
  ({
    id: `item-${id}`,
    position: 0,
    added_at: '2026-10-10T00:00:00Z',
    sermon: {
      id,
      title: `Title ${id}`,
      locked: false,
      media_type: 'audio',
      speaker_name: 'Ada',
      thumbnail_url: null,
      series_id: null,
      series_title: null,
      episode_number: null,
      category_name: 'Faith',
    },
  }) as never;

beforeEach(() => queueStore.reset());

describe('startPlaylistQueue', () => {
  it('returns null for an empty playlist and leaves the queue alone', () => {
    expect(startPlaylistQueue({ id: 'p1', name: 'Driving' }, [])).toBeNull();
    expect(queueStore.get().items).toEqual([]);
  });

  it('queues every row from the start, named after the playlist', () => {
    expect(startPlaylistQueue({ id: 'p1', name: 'Driving' }, [row('a'), row('b'), row('c')])).toBe('a');
    const state = queueStore.get();
    expect(state.items.map((item) => item.sermonId)).toEqual(['a', 'b', 'c']);
    expect(state.items.map((item) => item.playlistItemId)).toEqual(['item-a', 'item-b', 'item-c']);
    expect(state.index).toBe(0);
    expect(state.source).toEqual({ kind: 'playlist', id: 'p1', name: 'Driving' });
  });

  it('honours a start row', () => {
    expect(startPlaylistQueue({ id: 'p1', name: 'Driving' }, [row('a'), row('b'), row('c')], 2)).toBe('c');
    expect(queueStore.get().index).toBe(2);
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
