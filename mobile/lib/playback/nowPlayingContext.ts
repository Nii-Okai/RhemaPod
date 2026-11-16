import { createContext, useContext } from 'react';
import type { VideoPlayer } from 'expo-video';
import type { SleepTimer } from '../../app/player/_player/useSleepTimer';
import type { QueueItemInput } from './queue';

/*
 * The app-wide player's context on its own, with nothing heavy imported, so list rows can
 * reach it (`useQueueGesture`) without pulling the player, downloads and crypto into every
 * screen. `NowPlayingProvider` (`./NowPlaying.tsx`) is what fills it.
 */

/** What the mini player shows about the sermon in the shared player. */
export interface NowPlayingSession {
  sermonId: string;
  title: string;
  artist: string | null;
  artworkUrl: string | null;
  mediaType: 'audio' | 'video';
}

export interface SharedPlayerInput extends NowPlayingSession {
  uri: string;
}

export interface AcquiredPlayer {
  player: VideoPlayer;
  /**
   * True when the shared player was already playing this sermon before the player screen
   * opened (it came back from the mini player). The screen then leaves position and play
   * state alone instead of seeking to the saved resume point and starting over.
   */
  continued: boolean;
}

export interface NowPlayingValue {
  /** The sermon in the shared player, or null when nothing has played (or it was closed). */
  session: NowPlayingSession | null;
  /** True while the full player screen is showing it; the mini player hides then. */
  attached: boolean;
  player: VideoPlayer | null;
  acquire: (input: SharedPlayerInput, setup: (player: VideoPlayer) => void) => AcquiredPlayer;
  attach: (session: NowPlayingSession) => void;
  detach: () => void;
  /** Pauses and forgets the session: the mini player's close button. */
  stop: () => void;
  /** The sleep timer lives here, not on the screen, so it still pauses a sermon that
   * carries on in the mini player after the screen closes. */
  sleepTimer: SleepTimer;
  /**
   * The open player screen hands over how it moves to another sermon (it changes its own
   * route param). While one is registered, the queue moves on through it; otherwise this
   * provider loads the next sermon into the shared player itself, so a queue keeps playing
   * from the mini player or the lock screen. Returns the unregister function.
   */
  registerNavigator: (navigate: (sermonId: string) => void) => () => void;
  /** Plays the queue item at `index` (a queue row, the mini player's Next). */
  skipToIndex: (index: number) => void;
  /** "Play next" / "Add to queue" from anywhere. Starts playback when nothing is playing. */
  enqueue: (input: QueueItemInput, where: 'next' | 'last') => void;
  /** Opens the Play next / Add to queue sheet for a sermon (a long press on its row). */
  openQueueMenu: (input: QueueItemInput) => void;
}

export const NowPlayingContext = createContext<NowPlayingValue | null>(null);

export function useNowPlaying(): NowPlayingValue | null {
  return useContext(NowPlayingContext);
}
