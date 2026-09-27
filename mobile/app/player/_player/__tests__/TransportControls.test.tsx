import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { TransportControls } from '../TransportControls';

jest.mock('@expo/vector-icons');

const baseProps = {
  isPlaying: false,
  currentTimeSeconds: 62,
  durationSeconds: 1862,
  playbackSpeed: 1 as const,
  sleepRemainingSeconds: null,
  onTogglePlay: jest.fn(),
  onSeekBy: jest.fn(),
  onCycleSpeed: jest.fn(),
  onOpenSleepTimer: jest.fn(),
};

beforeEach(() => {
  baseProps.onTogglePlay = jest.fn();
  baseProps.onSeekBy = jest.fn();
  baseProps.onCycleSpeed = jest.fn();
  baseProps.onOpenSleepTimer = jest.fn();
});

describe('TransportControls', () => {
  it('renders current/duration time labels', () => {
    const { getByText } = render(<TransportControls {...baseProps} />);
    expect(getByText('1:02')).toBeTruthy();
    expect(getByText('31:02')).toBeTruthy();
  });

  it('shows Play when paused and fires onTogglePlay', () => {
    const { getByLabelText } = render(<TransportControls {...baseProps} />);
    fireEvent.press(getByLabelText('Play'));
    expect(baseProps.onTogglePlay).toHaveBeenCalledTimes(1);
  });

  it('shows Pause when playing', () => {
    const { getByLabelText } = render(<TransportControls {...baseProps} isPlaying />);
    expect(getByLabelText('Pause')).toBeTruthy();
  });

  it('seeks back/forward by 15 seconds', () => {
    const { getByLabelText } = render(<TransportControls {...baseProps} />);
    fireEvent.press(getByLabelText('Rewind 15 seconds'));
    fireEvent.press(getByLabelText('Skip forward 15 seconds'));
    expect(baseProps.onSeekBy).toHaveBeenNthCalledWith(1, -15);
    expect(baseProps.onSeekBy).toHaveBeenNthCalledWith(2, 15);
  });

  it('cycles speed on tap and shows the current multiplier', () => {
    const { getByLabelText } = render(<TransportControls {...baseProps} playbackSpeed={1.25} />);
    fireEvent.press(getByLabelText('Playback speed, 1.25×'));
    expect(baseProps.onCycleSpeed).toHaveBeenCalledTimes(1);
  });

  it('shows "off" sleep-timer state and opens the sheet on tap', () => {
    const { getByLabelText } = render(<TransportControls {...baseProps} />);
    fireEvent.press(getByLabelText('Sleep timer, off'));
    expect(baseProps.onOpenSleepTimer).toHaveBeenCalledTimes(1);
  });

  it('shows remaining time once a sleep timer is armed', () => {
    const { getByLabelText, getByText } = render(<TransportControls {...baseProps} sleepRemainingSeconds={905} />);
    expect(getByLabelText('Sleep timer, 15:05 remaining')).toBeTruthy();
    expect(getByText('15:05')).toBeTruthy();
  });

  it('renders "--:--" for duration while still loading (failure/loading mode)', () => {
    const { getAllByText } = render(<TransportControls {...baseProps} durationSeconds={null} />);
    expect(getAllByText('--:--').length).toBeGreaterThan(0);
  });
});
