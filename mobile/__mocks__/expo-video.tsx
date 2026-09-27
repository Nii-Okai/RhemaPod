import React, { useRef } from 'react';
import { View, type ViewProps } from 'react-native';

/**
 * Manual Jest mock for `expo-video`. The real `VideoPlayer`/`VideoView` are backed by
 * ExoPlayer/AVPlayer native machinery `jest-expo`'s test environment doesn't stand up
 * (same reasoning as the `@expo/vector-icons` manual mock alongside this one) — Player
 * screen tests exercise the screen's own logic (transport wiring, progress flush, notes),
 * not real video decoding, so this stands in a controllable fake player plus a bare
 * `<View>` for the video surface.
 *
 * The fake player implements the same `addListener`/`removeListener` shape the real
 * native `VideoPlayer` does (it extends expo-modules-core's `EventEmitter`) so that the
 * real, unmocked `useEvent`/`useEventListener` from the `expo` package — which the
 * screen uses to react to `statusChange`/`playingChange`/`timeUpdate`/`playToEnd` — work
 * against it exactly as they would against a real player, without this module needing to
 * duplicate those hooks.
 */

type Listener = (...args: unknown[]) => void;

class MockEventEmitter {
  private listeners = new Map<string, Set<Listener>>();

  addListener(eventName: string, listener: Listener) {
    if (!this.listeners.has(eventName)) this.listeners.set(eventName, new Set());
    this.listeners.get(eventName)!.add(listener);
    return { remove: () => this.listeners.get(eventName)?.delete(listener) };
  }

  removeListener(eventName: string, listener: Listener) {
    this.listeners.get(eventName)?.delete(listener);
  }

  emit(eventName: string, payload?: unknown) {
    this.listeners.get(eventName)?.forEach((listener) => listener(payload));
  }
}

export class MockVideoPlayer extends MockEventEmitter {
  playing = false;
  currentTime = 0;
  duration = 0;
  // Real `expo-video` players start `'loading'` the moment they're given a non-null
  // source (which every call site in this app always does — `useVideoPlayer` is never
  // called with `null` here) — not `'idle'`, which is reserved for a sourceless player.
  status: 'idle' | 'loading' | 'readyToPlay' | 'error' = 'loading';
  playbackRate = 1;
  bufferedPosition = 0;
  staysActiveInBackground = false;
  showNowPlayingNotification = false;
  timeUpdateEventInterval = 0;
  loop = false;
  muted = false;

  play = jest.fn(() => {
    this.playing = true;
    this.emit('playingChange', { isPlaying: true, oldIsPlaying: false });
  });

  pause = jest.fn(() => {
    this.playing = false;
    this.emit('playingChange', { isPlaying: false, oldIsPlaying: true });
  });

  seekBy = jest.fn((seconds: number) => {
    this.currentTime += seconds;
  });

  replace = jest.fn();
  replay = jest.fn();
  generateThumbnailsAsync = jest.fn();

  /** Test helper, not part of the real API: simulates the native side finishing a load. */
  __simulateReady(duration: number) {
    this.status = 'readyToPlay';
    this.duration = duration;
    this.emit('statusChange', { status: 'readyToPlay', oldStatus: 'loading' });
  }

  /** Test helper: simulates a `timeUpdate` tick. */
  __simulateTimeUpdate(currentTime: number) {
    this.currentTime = currentTime;
    this.bufferedPosition = currentTime;
    this.emit('timeUpdate', { currentTime, currentLiveTimestamp: null, currentOffsetFromLive: null, bufferedPosition: currentTime });
  }

  /** Test helper: simulates reaching the end of the source. */
  __simulatePlayToEnd() {
    this.playing = false;
    this.emit('playToEnd');
  }
}

/** The most recently created mock player — tests grab this to drive/inspect it. */
export let __lastMockPlayer: MockVideoPlayer | null = null;

export function useVideoPlayer(source: unknown, setup?: (player: MockVideoPlayer) => void): MockVideoPlayer {
  const playerRef = useRef<MockVideoPlayer | null>(null);
  if (!playerRef.current) {
    playerRef.current = new MockVideoPlayer();
    __lastMockPlayer = playerRef.current;
    setup?.(playerRef.current);
  }
  return playerRef.current;
}

export interface MockVideoViewProps extends ViewProps {
  player: MockVideoPlayer;
  nativeControls?: boolean;
  contentFit?: string;
  allowsFullscreen?: boolean;
}

export function VideoView({ player: _player, nativeControls: _nativeControls, contentFit: _contentFit, allowsFullscreen: _allowsFullscreen, ...rest }: MockVideoViewProps) {
  return <View testID="video-view" {...rest} />;
}
