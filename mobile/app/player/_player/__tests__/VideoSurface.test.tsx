import React from 'react';
import { render } from '@testing-library/react-native';
import { useVideoPlayer } from 'expo-video';
import { VideoSurface, type VideoSurfaceProps } from '../VideoSurface';
import type { ControlsOverlay } from '../useControlsOverlay';

jest.mock('@expo/vector-icons');

const overlay: ControlsOverlay = {
  visible: true,
  reduceMotion: true,
  toggle: jest.fn(),
  touch: jest.fn(),
};

type FixtureOverrides = Partial<Omit<VideoSurfaceProps, 'player' | 'videoRef'>>;

/** `useVideoPlayer` is a real hook (even against the manual mock, see
 * `__mocks__/expo-video.tsx`'s own doc comment) — it has to run inside a component, not
 * a bare helper function, so this harness builds the player and hands `VideoSurface` its
 * props from inside a render rather than constructing a player fixture by hand. */
function Harness({ overrides = {} }: { overrides?: FixtureOverrides }) {
  const player = useVideoPlayer({ uri: 'https://example.com/stream' });
  const props: VideoSurfaceProps = {
    player,
    videoRef: { current: null },
    isBuffering: false,
    isPlaying: false,
    isEnded: false,
    isAudio: false,
    artworkUrl: null,
    overlay,
    isFullscreen: false,
    onFullscreenChange: jest.fn(),
    onTogglePlay: jest.fn(),
    onReplay: jest.fn(),
    onSeekBy: jest.fn(),
    currentTimeSeconds: 0,
    durationSeconds: null,
    playbackSpeed: 1,
    sleepRemainingSeconds: null,
    onSeekTo: jest.fn(),
    onScrubStart: jest.fn(),
    onScrubEnd: jest.fn(),
    onCycleSpeed: jest.fn(),
    onOpenSleepTimer: jest.fn(),
    onToggleFullscreen: jest.fn(),
    ...overrides,
  };
  return <VideoSurface {...props} />;
}

describe("VideoSurface — audio artwork (Isaac's report: plain dark screen for audio)", () => {
  it('renders no artwork image for a video sermon', () => {
    const { queryByTestId } = render(
      <Harness overrides={{ isAudio: false, artworkUrl: 'https://cdn.example/art.jpg' }} />,
    );
    expect(queryByTestId('player-artwork')).toBeNull();
  });

  it('renders no artwork image for audio with no thumbnail url (falls back to the plain surface)', () => {
    const { queryByTestId } = render(<Harness overrides={{ isAudio: true, artworkUrl: null }} />);
    expect(queryByTestId('player-artwork')).toBeNull();
  });

  it('renders the sermon artwork over the surface for an audio-only sermon', () => {
    const { getByTestId } = render(
      <Harness overrides={{ isAudio: true, artworkUrl: 'https://cdn.example/art.jpg' }} />,
    );
    const image = getByTestId('player-artwork');
    expect(image.props.source).toEqual({ uri: 'https://cdn.example/art.jpg' });
  });
});
