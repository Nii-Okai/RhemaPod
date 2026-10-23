import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { PlaybackOverlayControls, PlayerBottomBar, SEEK_SECONDS } from '../TransportControls';

jest.mock('@expo/vector-icons');

const overlayProps = {
  isPlaying: false,
  isBuffering: false,
  isEnded: false,
  onTogglePlay: jest.fn(),
  onReplay: jest.fn(),
  onSeekBy: jest.fn(),
};

const barProps = {
  currentTimeSeconds: 62,
  durationSeconds: 1862,
  playbackSpeed: 1 as const,
  sleepRemainingSeconds: null,
  isFullscreen: false,
  isMuted: false,
  onToggleMute: jest.fn(),
  onSeekTo: jest.fn(),
  onSeekBy: jest.fn(),
  onScrubStart: jest.fn(),
  onScrubEnd: jest.fn(),
  onCycleSpeed: jest.fn(),
  onOpenSleepTimer: jest.fn(),
  onToggleFullscreen: jest.fn(),
};

beforeEach(() => {
  for (const fn of Object.values({ ...overlayProps, ...barProps })) {
    if (typeof fn === 'function') (fn as jest.Mock).mockClear();
  }
});

describe('PlaybackOverlayControls', () => {
  it('skips by 10 seconds each way (SEEK_SECONDS is 10, not 15)', () => {
    expect(SEEK_SECONDS).toBe(10);
    const { getByLabelText, queryByLabelText } = render(<PlaybackOverlayControls {...overlayProps} />);
    fireEvent.press(getByLabelText('Rewind 10 seconds'));
    fireEvent.press(getByLabelText('Skip forward 10 seconds'));
    expect(overlayProps.onSeekBy).toHaveBeenNthCalledWith(1, -10);
    expect(overlayProps.onSeekBy).toHaveBeenNthCalledWith(2, 10);
    expect(queryByLabelText(/15 seconds/)).toBeNull();
  });

  it('shows Play when paused and Pause when playing, firing onTogglePlay', () => {
    const paused = render(<PlaybackOverlayControls {...overlayProps} />);
    fireEvent.press(paused.getByLabelText('Play'));
    expect(overlayProps.onTogglePlay).toHaveBeenCalledTimes(1);

    const playing = render(<PlaybackOverlayControls {...overlayProps} isPlaying />);
    expect(playing.getByLabelText('Pause')).toBeTruthy();
  });

  it('swaps play for a Buffering spinner while buffering', () => {
    const { getByLabelText, queryByLabelText } = render(<PlaybackOverlayControls {...overlayProps} isBuffering />);
    expect(getByLabelText('Buffering')).toBeTruthy();
    expect(queryByLabelText('Play')).toBeNull();
  });

  it('offers Replay once the sermon has ended', () => {
    const { getByLabelText, queryByLabelText } = render(<PlaybackOverlayControls {...overlayProps} isEnded />);
    fireEvent.press(getByLabelText('Replay'));
    expect(overlayProps.onReplay).toHaveBeenCalledTimes(1);
    expect(queryByLabelText('Play')).toBeNull();
  });
});

describe('PlayerBottomBar', () => {
  it('renders elapsed / total with a spoken label', () => {
    const { getByText, getByLabelText } = render(<PlayerBottomBar {...barProps} />);
    expect(getByText('1:02 / 31:02')).toBeTruthy();
    expect(getByLabelText('1:02 of 31:02')).toBeTruthy();
  });

  it('cycles speed on tap and shows the current multiplier', () => {
    const { getByLabelText } = render(<PlayerBottomBar {...barProps} playbackSpeed={1.25} />);
    fireEvent.press(getByLabelText('Playback speed, 1.25×'));
    expect(barProps.onCycleSpeed).toHaveBeenCalledTimes(1);
  });

  it('shows the "off" sleep-timer state and opens the sheet on tap', () => {
    const { getByLabelText } = render(<PlayerBottomBar {...barProps} />);
    fireEvent.press(getByLabelText('Sleep timer, off'));
    expect(barProps.onOpenSleepTimer).toHaveBeenCalledTimes(1);
  });

  it('shows remaining time once a sleep timer is armed', () => {
    const { getByLabelText, getByText } = render(<PlayerBottomBar {...barProps} sleepRemainingSeconds={905} />);
    expect(getByLabelText('Sleep timer, 15:05 remaining')).toBeTruthy();
    expect(getByText('15:05')).toBeTruthy();
  });

  it('toggles mute with a label that says what a tap will do', () => {
    const unmuted = render(<PlayerBottomBar {...barProps} />);
    fireEvent.press(unmuted.getByLabelText('Mute'));
    expect(barProps.onToggleMute).toHaveBeenCalledTimes(1);

    const muted = render(<PlayerBottomBar {...barProps} isMuted />);
    expect(muted.getByLabelText('Unmute')).toBeTruthy();
  });

  it('toggles native fullscreen with the matching label', () => {
    const entering = render(<PlayerBottomBar {...barProps} />);
    fireEvent.press(entering.getByLabelText('Enter full screen'));
    expect(barProps.onToggleFullscreen).toHaveBeenCalledTimes(1);

    const exiting = render(<PlayerBottomBar {...barProps} isFullscreen />);
    expect(exiting.getByLabelText('Exit full screen')).toBeTruthy();
  });

  it('exposes the seek bar as adjustable, stepping by the 10s skip constant', () => {
    const { getByLabelText } = render(<PlayerBottomBar {...barProps} />);
    const seek = getByLabelText('Seek');
    expect(seek.props.accessibilityRole).toBe('adjustable');
    expect(seek.props.accessibilityValue).toEqual({ text: '1:02 of 31:02' });

    fireEvent(seek, 'accessibilityAction', { nativeEvent: { actionName: 'increment' } });
    fireEvent(seek, 'accessibilityAction', { nativeEvent: { actionName: 'decrement' } });
    expect(barProps.onSeekBy).toHaveBeenNthCalledWith(1, 10);
    expect(barProps.onSeekBy).toHaveBeenNthCalledWith(2, -10);
  });

  it('renders "--:--" and a disabled seek bar while the duration is still loading', () => {
    const { getAllByText, getByLabelText } = render(<PlayerBottomBar {...barProps} durationSeconds={null} />);
    expect(getAllByText(/--:--/).length).toBeGreaterThan(0);
    expect(getByLabelText('Seek').props.accessibilityState.disabled).toBe(true);
  });
});
