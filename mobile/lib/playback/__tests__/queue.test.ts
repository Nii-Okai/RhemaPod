import {
  EMPTY_QUEUE,
  addToQueue,
  appendAutoplay,
  clearUpcoming,
  currentItem,
  moveToNext,
  nextEpisodeAfter,
  nextIndex,
  playNext,
  playNow,
  previousIndex,
  queueMetaLine,
  removeItem,
  removeSermon,
  shuffleUpcoming,
  skipTo,
  startQueue,
  syncToSermon,
  toggleRepeat,
  type QueueItemInput,
  type QueueState,
} from '../queue';

const input = (sermonId: string, extra: Partial<QueueItemInput> = {}): QueueItemInput => ({
  sermonId,
  title: `Title ${sermonId}`,
  artist: null,
  meta: null,
  category: null,
  artworkUrl: null,
  mediaType: 'audio',
  seriesId: null,
  ...extra,
});

const ids = (state: QueueState) => state.items.map((item) => item.sermonId);
const playlist = (...sermonIds: string[]) =>
  startQueue(EMPTY_QUEUE, sermonIds.map((id) => input(id)), 0, { kind: 'playlist', id: 'p1', name: 'Driving' });

describe('starting playback', () => {
  it('starts a list from the chosen item', () => {
    const state = startQueue(EMPTY_QUEUE, [input('a'), input('b'), input('c')], 1);
    expect(ids(state)).toEqual(['a', 'b', 'c']);
    expect(currentItem(state)?.sermonId).toBe('b');
  });

  it('keeps what the listener queued straight after the new item, before the rest of the list', () => {
    let state = playlist('a', 'b');
    state = addToQueue(state, input('x'));
    state = startQueue(state, [input('c'), input('d')], 0);
    expect(ids(state)).toEqual(['c', 'x', 'd']);
    expect(state.index).toBe(0);
  });

  it('a single sermon from anywhere replaces the playlist and its repeat', () => {
    let state = toggleRepeat(playlist('a', 'b'));
    state = playNow(state, input('z'));
    expect(ids(state)).toEqual(['z']);
    expect(state.repeat).toBe(false);
    expect(state.source).toBeNull();
  });
});

describe('syncToSermon', () => {
  it('leaves the queue alone when the sermon is already the current item', () => {
    const state = playlist('a', 'b');
    const synced = syncToSermon(state, input('a', { title: 'Title a' }));
    expect(synced).toBe(state);
  });

  it('refreshes the current item from the loaded detail without moving', () => {
    const state = playlist('a', 'b');
    const synced = syncToSermon(state, input('a', { artist: 'Ada', seriesId: 's1' }));
    expect(ids(synced)).toEqual(['a', 'b']);
    expect(currentItem(synced)).toMatchObject({ artist: 'Ada', seriesId: 's1', key: currentItem(state)!.key });
  });

  it('plays a sermon opened from elsewhere now', () => {
    const synced = syncToSermon(playlist('a', 'b'), input('z'));
    expect(ids(synced)).toEqual(['z']);
  });
});

describe('Play next and Add to queue', () => {
  it('Play next goes straight after the current item', () => {
    let state = playlist('a', 'b', 'c');
    state = playNext(state, input('x'));
    state = playNext(state, input('y'));
    expect(ids(state)).toEqual(['a', 'y', 'x', 'b', 'c']);
  });

  it('Add to queue goes after the listener\'s other picks, before the rest of the playlist', () => {
    let state = playlist('a', 'b', 'c');
    state = addToQueue(state, input('x'));
    state = addToQueue(state, input('y'));
    expect(ids(state)).toEqual(['a', 'x', 'y', 'b', 'c']);
    expect(state.items.map((item) => item.origin)).toEqual(['context', 'user', 'user', 'context', 'context']);
  });

  it('with nothing playing, either one becomes the current item', () => {
    expect(ids(playNext(EMPTY_QUEUE, input('x')))).toEqual(['x']);
    expect(addToQueue(EMPTY_QUEUE, input('x')).index).toBe(0);
  });

  it('the same sermon can be queued twice, each with its own key', () => {
    let state = playlist('a');
    state = addToQueue(state, input('x'));
    state = addToQueue(state, input('x'));
    expect(ids(state)).toEqual(['a', 'x', 'x']);
    expect(new Set(state.items.map((item) => item.key)).size).toBe(3);
  });
});

describe('editing the queue', () => {
  it('removes an upcoming item, never the playing one', () => {
    const state = skipTo(playlist('a', 'b', 'c'), 1);
    expect(ids(removeItem(state, state.items[2]!.key))).toEqual(['a', 'b']);
    expect(removeItem(state, state.items[1]!.key)).toBe(state);
    const withoutPlayed = removeItem(state, state.items[0]!.key);
    expect(ids(withoutPlayed)).toEqual(['b', 'c']);
    expect(currentItem(withoutPlayed)?.sermonId).toBe('b');
  });

  it('removes every queued copy of a sermon that left the playlist', () => {
    let state = playlist('a', 'b');
    state = addToQueue(state, input('b'));
    expect(ids(removeSermon(state, 'b'))).toEqual(['a']);
  });

  it('moves an item to play next', () => {
    const state = playlist('a', 'b', 'c', 'd');
    const moved = moveToNext(state, state.items[3]!.key);
    expect(ids(moved)).toEqual(['a', 'd', 'b', 'c']);
    expect(moved.items[1]!.origin).toBe('user');
  });

  it('moves an already played item back up without losing the current one', () => {
    const state = skipTo(playlist('a', 'b', 'c'), 2);
    const moved = moveToNext(state, state.items[0]!.key);
    expect(ids(moved)).toEqual(['b', 'c', 'a']);
    expect(currentItem(moved)?.sermonId).toBe('c');
  });

  it('clears what is up next, keeping the history', () => {
    const state = skipTo(playlist('a', 'b', 'c'), 1);
    expect(ids(clearUpcoming(state))).toEqual(['a', 'b']);
  });

  it('shuffles only what has not played', () => {
    const state = skipTo(playlist('a', 'b', 'c', 'd', 'e'), 1);
    const shuffledState = shuffleUpcoming(state, () => 0);
    expect(ids(shuffledState).slice(0, 2)).toEqual(['a', 'b']);
    expect(ids(shuffledState).slice(2).sort()).toEqual(['c', 'd', 'e']);
    expect(ids(shuffledState).slice(2)).not.toEqual(['c', 'd', 'e']);
  });
});

describe('moving through the queue', () => {
  it('stops at the end, or wraps with repeat on', () => {
    const state = skipTo(playlist('a', 'b'), 1);
    expect(nextIndex(state)).toBeNull();
    expect(nextIndex(toggleRepeat(state))).toBe(0);
    expect(previousIndex(state)).toBe(0);
    expect(nextIndex(EMPTY_QUEUE)).toBeNull();
  });

  it('autoplay picks are appended and marked', () => {
    const state = appendAutoplay(playlist('a'), input('e2'));
    expect(nextIndex(state)).toBe(1);
    expect(state.items[1]!.origin).toBe('autoplay');
  });
});

describe('nextEpisodeAfter', () => {
  const ep = (id: string, extra: Record<string, unknown> = {}) => ({
    id,
    title: id,
    locked: false,
    media_type: 'audio' as const,
    thumbnail_url: null,
    series_id: 's1',
    ...extra,
  });

  it('is the next episode in the series\' own order', () => {
    expect(nextEpisodeAfter([ep('e1'), ep('e2'), ep('e3')], 'e1')?.id).toBe('e2');
  });

  it('passes over locked episodes and ones with no media yet', () => {
    expect(nextEpisodeAfter([ep('e1'), ep('e2', { locked: true }), ep('e3', { media_type: null }), ep('e4')], 'e1')?.id).toBe('e4');
  });

  it('is null after the last episode, or for a sermon not in the list', () => {
    expect(nextEpisodeAfter([ep('e1'), ep('e2')], 'e2')).toBeNull();
    expect(nextEpisodeAfter([ep('e1')], 'zz')).toBeNull();
  });
});

describe('queueMetaLine', () => {
  it('names the series and episode, else the series, else the category', () => {
    expect(queueMetaLine({ series_title: 'Storms', episode_number: 2, category_name: 'Faith' })).toBe('Storms · Episode 2');
    expect(queueMetaLine({ series_title: 'Storms', episode_number: null })).toBe('Storms');
    expect(queueMetaLine({ series_title: null, category_name: 'Faith' })).toBe('Faith');
  });
});
