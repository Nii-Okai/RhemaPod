import { useSyncExternalStore } from 'react';

/**
 * The app-wide playback queue (Nii's review, 2026-11-14: "a queue that works everywhere
 * content plays"). Before this the queue lived in the player screen's route params and
 * only a playlist's Play/Shuffle could start one, so nothing queued outside a playlist and
 * nothing advanced once the player screen closed.
 *
 * It is one ordered list with a cursor, the way the big streaming apps behave:
 *
 * - Starting something (a sermon from any list, a playlist's Play) makes it the current
 *   item. Items the listener queued themselves ("Play next", "Add to queue") survive that
 *   and still play right after it.
 * - "Play next" goes straight after the current item. "Add to queue" goes after any other
 *   items the listener queued, but before the rest of the playlist that was playing.
 * - At the end of the list, repeat wraps to the start. Otherwise the player may append the
 *   next episode of the current sermon's series, when "Autoplay next in series" is on
 *   (`NowPlayingProvider` decides that, since it needs the network and the preference).
 *
 * Everything here is pure (state in, state out) so it can be tested without a player. The
 * store at the bottom holds the one live copy for the whole app.
 */

export interface QueueItem {
  /** Unique within the queue: the same sermon can be queued twice. */
  key: string;
  sermonId: string;
  title: string;
  /** Speaker: the lock screen's artist line. */
  artist: string | null;
  /** The queue row's second line (series and episode, or category). */
  meta: string | null;
  /** Kept for a download started from the queue (the Downloads tab shows it). */
  category: string | null;
  artworkUrl: string | null;
  mediaType: 'audio' | 'video' | null;
  /** Lets autoplay find the next episode once the queue runs out. */
  seriesId: string | null;
  /** The playlist row this came from, so the queue can offer "Remove from playlist". */
  playlistItemId?: string;
  /** How it got here: part of what was started, queued by the listener, or autoplay. */
  origin: 'context' | 'user' | 'autoplay';
}

export type QueueItemInput = Omit<QueueItem, 'key' | 'origin'>;

export type QueueSource =
  | { kind: 'playlist'; id: string; name: string }
  | { kind: 'series'; id: string; name: string }
  | null;

export interface QueueState {
  items: QueueItem[];
  /** Position of the playing item, -1 when the queue is empty. */
  index: number;
  repeat: boolean;
  /** What the queue was started from: names the queue panel and keeps playlist actions. */
  source: QueueSource;
}

export const EMPTY_QUEUE: QueueState = { items: [], index: -1, repeat: false, source: null };

let keySeed = 0;
function withKey(input: QueueItemInput, origin: QueueItem['origin']): QueueItem {
  keySeed += 1;
  return { ...input, key: `q${keySeed}`, origin };
}

export function currentItem(state: QueueState): QueueItem | null {
  return state.items[state.index] ?? null;
}

export function upcoming(state: QueueState): QueueItem[] {
  return state.index < 0 ? [] : state.items.slice(state.index + 1);
}

/** The listener's own queued items waiting right after the current one. */
function upcomingUserItems(state: QueueState): QueueItem[] {
  const out: QueueItem[] = [];
  for (const item of upcoming(state)) {
    if (item.origin !== 'user') break;
    out.push(item);
  }
  return out;
}

/**
 * Starts `inputs` from `startIndex`, keeping the listener's own queued items so they still
 * play straight after the new current item.
 */
export function startQueue(state: QueueState, inputs: QueueItemInput[], startIndex = 0, source: QueueSource = null): QueueState {
  if (inputs.length === 0) return state;
  const start = Math.min(Math.max(0, startIndex), inputs.length - 1);
  const context = inputs.map((input) => withKey(input, 'context'));
  const kept = upcomingUserItems(state);
  const items = [...context.slice(0, start + 1), ...kept, ...context.slice(start + 1)];
  return { items, index: start, repeat: false, source };
}

/** One sermon, from anywhere in the app: its own queue of one, plus anything the listener queued. */
export function playNow(state: QueueState, input: QueueItemInput): QueueState {
  return startQueue(state, [input], 0, null);
}

/**
 * The player screen opened on `input`. Nothing changes when it is already the current
 * item (back from the mini player, or the queue itself moved on); anything else was opened
 * from elsewhere and plays now. Metadata is refreshed from the loaded detail either way.
 */
export function syncToSermon(state: QueueState, input: QueueItemInput): QueueState {
  const current = currentItem(state);
  if (current && current.sermonId === input.sermonId) {
    const merged = { ...current, ...input, playlistItemId: current.playlistItemId ?? input.playlistItemId };
    const unchanged = (Object.keys(merged) as (keyof QueueItem)[]).every((k) => merged[k] === current[k]);
    if (unchanged) return state;
    const items = [...state.items];
    items[state.index] = merged;
    return { ...state, items };
  }
  return playNow(state, input);
}

export function playNext(state: QueueState, input: QueueItemInput): QueueState {
  if (state.index < 0) return { items: [withKey(input, 'user')], index: 0, repeat: false, source: null };
  const items = [...state.items];
  items.splice(state.index + 1, 0, withKey(input, 'user'));
  return { ...state, items };
}

export function addToQueue(state: QueueState, input: QueueItemInput): QueueState {
  if (state.index < 0) return { items: [withKey(input, 'user')], index: 0, repeat: false, source: null };
  const at = state.index + 1 + upcomingUserItems(state).length;
  const items = [...state.items];
  items.splice(at, 0, withKey(input, 'user'));
  return { ...state, items };
}

/** Autoplay's pick goes on the end, marked so the panel can say where it came from. */
export function appendAutoplay(state: QueueState, input: QueueItemInput): QueueState {
  return { ...state, items: [...state.items, withKey(input, 'autoplay')] };
}

/** Removes a queued item. The playing item stays: stopping is the player's job. */
export function removeItem(state: QueueState, key: string): QueueState {
  const at = state.items.findIndex((item) => item.key === key);
  if (at < 0 || at === state.index) return state;
  const items = state.items.filter((item) => item.key !== key);
  return { ...state, items, index: at < state.index ? state.index - 1 : state.index };
}

/** Removes every queued copy of a sermon except the playing one (e.g. it left the playlist). */
export function removeSermon(state: QueueState, sermonId: string): QueueState {
  let next = state;
  for (const item of state.items) {
    if (item.sermonId === sermonId) next = removeItem(next, item.key);
  }
  return next;
}

/** Moves a queued item to play straight after the current one. */
export function moveToNext(state: QueueState, key: string): QueueState {
  const at = state.items.findIndex((item) => item.key === key);
  if (at < 0 || at === state.index) return state;
  const items = [...state.items];
  const [moved] = items.splice(at, 1);
  const index = at < state.index ? state.index - 1 : state.index;
  items.splice(index + 1, 0, { ...moved!, origin: 'user' });
  return { ...state, items, index };
}

/** Clears everything after the playing item. Already played items stay for going back. */
export function clearUpcoming(state: QueueState): QueueState {
  if (state.index < 0) return state;
  return { ...state, items: state.items.slice(0, state.index + 1) };
}

export function skipTo(state: QueueState, index: number): QueueState {
  if (index < 0 || index >= state.items.length || index === state.index) return state;
  return { ...state, index };
}

export function toggleRepeat(state: QueueState): QueueState {
  return { ...state, repeat: !state.repeat };
}

/** Fisher–Yates — uniform, on a copy. */
export function shuffled<T>(items: T[], random: () => number = Math.random): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
}

/** Shuffles what has not played yet; the played items and the current one stay put. */
export function shuffleUpcoming(state: QueueState, random: () => number = Math.random): QueueState {
  if (state.index < 0) return state;
  return { ...state, items: [...state.items.slice(0, state.index + 1), ...shuffled(upcoming(state), random)] };
}

/** The index that plays after the current item, or null at the end with repeat off. */
export function nextIndex(state: QueueState): number | null {
  if (state.index < 0) return null;
  if (state.index + 1 < state.items.length) return state.index + 1;
  return state.repeat && state.items.length > 0 ? 0 : null;
}

export function previousIndex(state: QueueState): number | null {
  return state.index > 0 ? state.index - 1 : null;
}

export interface SermonLike {
  id: string;
  title: string;
  episode_number?: number | null;
  series_title?: string | null;
  category_name?: string | null;
  locked: boolean;
  media_type?: 'audio' | 'video' | null;
  speaker_name?: string | null;
  thumbnail_url: string | null;
  series_id: string | null;
}

/**
 * The episode autoplay moves on to: the first one after `currentId` in the series' own
 * order (the server's, never re-sorted here) that this listener can play now. Locked and
 * not-yet-uploaded episodes are passed over rather than stopping the run. `null` when the
 * current sermon is the last playable one, or isn't in the list at all.
 */
export function nextEpisodeAfter<T extends SermonLike>(episodes: T[], currentId: string): T | null {
  const at = episodes.findIndex((episode) => episode.id === currentId);
  if (at < 0) return null;
  return episodes.slice(at + 1).find((episode) => !episode.locked && Boolean(episode.media_type)) ?? null;
}

/** "Series · Episode 3", the series alone, or the category: the line every list uses. */
export function queueMetaLine(sermon: Pick<SermonLike, 'series_title' | 'episode_number' | 'category_name'>): string | null {
  if (sermon.series_title) {
    return sermon.episode_number != null ? `${sermon.series_title} · Episode ${sermon.episode_number}` : sermon.series_title;
  }
  return sermon.category_name ?? null;
}

/** A queue entry for any sermon-shaped record (a list card, a detail, an episode). */
export function queueItemFromSermon(sermon: SermonLike, artworkFallback: string | null = null): QueueItemInput {
  return {
    sermonId: sermon.id,
    title: sermon.title,
    artist: sermon.speaker_name ?? null,
    meta: queueMetaLine(sermon),
    category: sermon.category_name ?? null,
    artworkUrl: sermon.thumbnail_url ?? artworkFallback,
    mediaType: sermon.media_type ?? null,
    seriesId: sermon.series_id,
  };
}

// ---------------------------------------------------------------------------------------
// The live store. A tiny external store rather than React context, so the queue reads the
// same from the player screen, the mini player, list rows and `NowPlayingProvider`, and a
// screen rendered without the provider (unit tests, the dev gallery) still has one.

type Listener = () => void;
let live: QueueState = EMPTY_QUEUE;
const listeners = new Set<Listener>();

export const queueStore = {
  get: (): QueueState => live,
  set(next: QueueState) {
    if (next === live) return;
    live = next;
    listeners.forEach((listener) => listener());
  },
  update(fn: (state: QueueState) => QueueState) {
    queueStore.set(fn(live));
  },
  subscribe(listener: Listener) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  /** Tests only. */
  reset() {
    live = EMPTY_QUEUE;
    listeners.forEach((listener) => listener());
  },
};

export function usePlaybackQueue(): QueueState {
  return useSyncExternalStore(queueStore.subscribe, queueStore.get, queueStore.get);
}
