import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { AsyncStorage } from 'expo-sqlite/kv-store';
import { StyleSheet } from 'react-native';
import { createVideoPlayer } from 'expo-video';
import type { MockVideoPlayer } from '../../../__mocks__/expo-video';
import { NowPlayingContext, type NowPlayingValue } from '../../../lib/playback/nowPlayingContext';
import {
  resetMiniPlayerPositionForTests,
  setMiniPlayerTop,
} from '../../../lib/playback/miniPlayerPosition';
import {
  MINI_PLAYER_CARD_HEIGHT,
  MINI_PLAYER_SLOT_HEIGHT,
  MiniPlayer,
  MiniPlayerSlot,
  dragPosition,
  restingPosition,
} from '../MiniPlayer';

/**
 * The draggable mini player. The drag itself is core `PanResponder`;
 * what is tested here is the behaviour around it: where a release comes to rest, that the
 * position is shared and remembered, that the tabs' band closes once the card is moved
 * away, and that the card's taps and the screen-reader alternative still work.
 */

jest.mock('expo-video');
jest.mock('@expo/vector-icons');
jest.mock('expo-sqlite/kv-store', () => ({
  AsyncStorage: {
    getItem: jest.fn(async () => null),
    setItem: jest.fn(async () => undefined),
    removeItem: jest.fn(async () => undefined),
  },
}));
const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 40, bottom: 0, left: 0, right: 0 }),
}));

const newPlayer = () => (createVideoPlayer as unknown as () => MockVideoPlayer)();
const storage = AsyncStorage as unknown as { getItem: jest.Mock; setItem: jest.Mock; removeItem: jest.Mock };

function nowPlaying(player: MockVideoPlayer, extra: Partial<NowPlayingValue> = {}): NowPlayingValue {
  return {
    session: { sermonId: 's1', title: 'Sermon one', artist: 'Prophet', artworkUrl: null, mediaType: 'audio' },
    attached: false,
    player: player as unknown as NowPlayingValue['player'],
    stop: jest.fn(),
    skipToIndex: jest.fn(),
    ...extra,
  } as unknown as NowPlayingValue;
}

beforeEach(() => {
  resetMiniPlayerPositionForTests();
  jest.clearAllMocks();
});

describe('where a drag comes to rest', () => {
  // translateY units: 0 is the home spot, -600 the highest it may go.
  const highest = -600;

  it('stays where it was let go when released slowly', () => {
    expect(restingPosition(-300, 0, highest)).toBe(-300);
  });

  it('carries on in the direction of a flick', () => {
    expect(restingPosition(-300, -1, highest)).toBeLessThan(-300);
    expect(restingPosition(-300, 1, highest)).toBeGreaterThan(-300);
  });

  it('never leaves the screen, however hard it is thrown', () => {
    expect(restingPosition(-500, -5, highest)).toBe(highest);
    expect(restingPosition(-100, 5, highest)).toBe(0);
  });

  it('docks back when let go near home', () => {
    expect(restingPosition(-40, 0, highest)).toBe(0);
    expect(restingPosition(-120, 0, highest)).toBe(-120);
  });

  it('follows the finger inside the limits and resists past them', () => {
    expect(dragPosition(-250, highest)).toBe(-250);
    expect(dragPosition(-700, highest)).toBeGreaterThan(-700);
    expect(dragPosition(-700, highest)).toBeLessThan(highest);
    expect(dragPosition(50, highest)).toBeGreaterThan(0);
    expect(dragPosition(50, highest)).toBeLessThan(50);
  });
});

describe('the tabs band for the docked card', () => {
  const slot = (value: NowPlayingValue | null, onHomeBottom = jest.fn()) => (
    <NowPlayingContext.Provider value={value}>
      <MiniPlayerSlot onHomeBottom={onHomeBottom} />
    </NowPlayingContext.Provider>
  );

  it('keeps room for the card while it is docked', () => {
    const view = render(slot(nowPlaying(newPlayer())));
    expect(StyleSheet.flatten(view.getByTestId('mini-player-slot').props.style)).toMatchObject({ height: MINI_PLAYER_SLOT_HEIGHT });
  });

  it('gives the room back once the card is dragged away, and when nothing plays', () => {
    const view = render(slot(nowPlaying(newPlayer())));
    act(() => setMiniPlayerTop(200));
    expect(StyleSheet.flatten(view.getByTestId('mini-player-slot').props.style)).toMatchObject({ height: 0 });
    act(() => setMiniPlayerTop(null));
    view.rerender(slot(null));
    expect(StyleSheet.flatten(view.getByTestId('mini-player-slot').props.style)).toMatchObject({ height: 0 });
  });

  it('reports where the docked card sits', () => {
    const onHomeBottom = jest.fn();
    const view = render(slot(nowPlaying(newPlayer()), onHomeBottom));
    fireEvent(view.getByTestId('mini-player-slot'), 'layout', {
      nativeEvent: { layout: { x: 0, y: 700, width: 390, height: MINI_PLAYER_SLOT_HEIGHT } },
    });
    expect(onHomeBottom).toHaveBeenCalledWith(700 + MINI_PLAYER_SLOT_HEIGHT);
  });
});

describe('the draggable card', () => {
  const homeBottom = 760;
  const card = (value: NowPlayingValue) => (
    <NowPlayingContext.Provider value={value}>
      <MiniPlayer homeBottom={homeBottom} />
    </NowPlayingContext.Provider>
  );

  it('keeps its tap and buttons', () => {
    const player = newPlayer();
    const view = render(card(nowPlaying(player)));
    fireEvent.press(view.getByLabelText('Play'));
    expect(player.play).toHaveBeenCalled();
    fireEvent.press(view.getByLabelText('Now playing: Sermon one. Open the player.'));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/player/[id]', params: { id: 's1' } });
  });

  it('moves to the top and back for VoiceOver and TalkBack, and remembers it', () => {
    jest.useFakeTimers();
    try {
      const view = render(card(nowPlaying(newPlayer())));
      const target = view.getByLabelText('Now playing: Sermon one. Open the player.');
      expect(target.props.accessibilityActions).toEqual([{ name: 'moveUp', label: 'Move to top' }]);

      fireEvent(target, 'accessibilityAction', { nativeEvent: { actionName: 'moveUp' } });
      act(() => jest.runAllTimers());
      // Just under the status bar (40) plus the 8pt margin.
      expect(storage.setItem).toHaveBeenCalledWith('rhemapod-mini-player-top', '48');

      const moved = view.getByLabelText('Now playing: Sermon one. Open the player.');
      expect(moved.props.accessibilityActions).toEqual([{ name: 'moveDown', label: 'Move back down' }]);
      fireEvent(moved, 'accessibilityAction', { nativeEvent: { actionName: 'moveDown' } });
      act(() => jest.runAllTimers());
      expect(storage.removeItem).toHaveBeenCalledWith('rhemapod-mini-player-top');
    } finally {
      jest.useRealTimers();
    }
  });

  it('opens where it was left last time', async () => {
    storage.getItem.mockResolvedValueOnce('300');
    const view = render(card(nowPlaying(newPlayer())));
    await act(async () => {});
    const layer = view.getByTestId('mini-player-layer');
    const homeTop = homeBottom - MINI_PLAYER_CARD_HEIGHT;
    expect(StyleSheet.flatten(layer.props.style)).toMatchObject({
      top: homeTop,
      transform: [{ translateY: 300 - homeTop }, { scale: 1 }],
    });
  });
});
