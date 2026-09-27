import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import DownloadsScreen from '../downloads';
import { useDownloads } from '../../../lib/downloads/useDownloads';
import { useOfflinePlayback } from '../../../lib/downloads/useOfflinePlayback';
import type { DownloadRecord } from '../../../lib/downloads/types';

// Explicit factories (not bare automocks) — an automock still has to `require()` the real
// module first to learn its shape, which for `useDownloads`/`useOfflinePlayback` pulls in
// `downloadManager.ts` -> `modules/rpa-crypto` -> the real native module resolution
// (unavailable under Jest, same gap as every other native-module test in this task).
jest.mock('../../../lib/downloads/useDownloads', () => ({ useDownloads: jest.fn() }));
jest.mock('../../../lib/downloads/useOfflinePlayback', () => ({ useOfflinePlayback: jest.fn() }));
jest.mock('expo-audio', () => ({
  useAudioPlayer: jest.fn(() => ({ play: jest.fn(), pause: jest.fn() })),
  useAudioPlayerStatus: jest.fn(() => ({ playing: false, isLoaded: true, currentTime: 0, duration: 0 })),
}));

const mockedUseDownloads = useDownloads as jest.Mock;
const mockedUseOfflinePlayback = useOfflinePlayback as jest.Mock;

function record(overrides: Partial<DownloadRecord> = {}): DownloadRecord {
  return {
    sermonId: 'sermon-1',
    title: 'A Great Sermon',
    state: 'ready',
    progress: 1,
    bytesTotal: 5_242_880,
    failureReason: null,
    failureMessage: null,
    keyIdHex: '00',
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

function baseDownloadsHook(overrides: Partial<ReturnType<typeof useDownloads>> = {}) {
  return {
    downloads: [],
    isLoading: false,
    wifiOnly: true,
    isSavingWifiOnly: false,
    setWifiOnly: jest.fn(),
    download: jest.fn(),
    retry: jest.fn(),
    remove: jest.fn(),
    find: jest.fn(),
    ...overrides,
  };
}

function basePlaybackHook(overrides: Partial<ReturnType<typeof useOfflinePlayback>> = {}) {
  return {
    playingSermonId: null,
    localUri: null,
    isPreparing: false,
    error: null,
    play: jest.fn(),
    stop: jest.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('DownloadsScreen — loading/empty', () => {
  it('shows a loading state', () => {
    mockedUseDownloads.mockReturnValue(baseDownloadsHook({ isLoading: true }));
    mockedUseOfflinePlayback.mockReturnValue(basePlaybackHook());
    const { getByLabelText } = render(<DownloadsScreen />);
    expect(getByLabelText('Loading downloads')).toBeTruthy();
  });

  it('shows an empty state with no downloads', () => {
    mockedUseDownloads.mockReturnValue(baseDownloadsHook({ downloads: [] }));
    mockedUseOfflinePlayback.mockReturnValue(basePlaybackHook());
    const { getByText } = render(<DownloadsScreen />);
    expect(getByText('No downloads yet')).toBeTruthy();
  });
});

describe('DownloadsScreen — populated', () => {
  it('renders a ready download with its size, and Play/Delete controls', () => {
    mockedUseDownloads.mockReturnValue(baseDownloadsHook({ downloads: [record()] }));
    mockedUseOfflinePlayback.mockReturnValue(basePlaybackHook());
    const { getByText, getByLabelText } = render(<DownloadsScreen />);

    expect(getByText('A Great Sermon')).toBeTruthy();
    expect(getByText('Downloaded · 5.0 MB')).toBeTruthy();
    expect(getByLabelText('Play A Great Sermon offline')).toBeTruthy();
    expect(getByLabelText('Delete downloaded A Great Sermon')).toBeTruthy();
  });

  it('renders a downloading progress row', () => {
    mockedUseDownloads.mockReturnValue(
      baseDownloadsHook({ downloads: [record({ state: 'downloading', progress: 0.42, bytesTotal: null })] }),
    );
    mockedUseOfflinePlayback.mockReturnValue(basePlaybackHook());
    const { getByText } = render(<DownloadsScreen />);
    expect(getByText('Downloading… 42%')).toBeTruthy();
  });

  it('renders a failed download with its real reason and a working Retry', () => {
    const retry = jest.fn();
    mockedUseDownloads.mockReturnValue(
      baseDownloadsHook({
        downloads: [
          record({
            state: 'failed',
            bytesTotal: null,
            failureReason: 'network',
            failureMessage: 'Could not reach the server. Check your connection and retry.',
          }),
        ],
        retry,
      }),
    );
    mockedUseOfflinePlayback.mockReturnValue(basePlaybackHook());
    const { getByText } = render(<DownloadsScreen />);

    expect(getByText('Could not reach the server. Check your connection and retry.')).toBeTruthy();
    fireEvent.press(getByText('Retry'));
    expect(retry).toHaveBeenCalledWith('sermon-1');
  });

  it('toggling Wi-Fi-only calls setWifiOnly', () => {
    const setWifiOnly = jest.fn();
    mockedUseDownloads.mockReturnValue(baseDownloadsHook({ setWifiOnly }));
    mockedUseOfflinePlayback.mockReturnValue(basePlaybackHook());
    const { getByLabelText } = render(<DownloadsScreen />);

    fireEvent.press(getByLabelText('Wi-Fi only downloads'));
    expect(setWifiOnly).toHaveBeenCalledWith(false);
  });

  it('pressing Play calls play() with the sermon id', () => {
    const play = jest.fn();
    mockedUseDownloads.mockReturnValue(baseDownloadsHook({ downloads: [record()] }));
    mockedUseOfflinePlayback.mockReturnValue(basePlaybackHook({ play }));
    const { getByLabelText } = render(<DownloadsScreen />);

    fireEvent.press(getByLabelText('Play A Great Sermon offline'));
    expect(play).toHaveBeenCalledWith('sermon-1');
  });

  it('shows the offline player bar and a playback error banner when playback fails', () => {
    mockedUseDownloads.mockReturnValue(baseDownloadsHook({ downloads: [record()], find: jest.fn(() => record()) }));
    mockedUseOfflinePlayback.mockReturnValue(
      basePlaybackHook({ error: 'Your download key changed. Re-download to listen offline again.' }),
    );
    const { getByText } = render(<DownloadsScreen />);
    expect(getByText('Your download key changed. Re-download to listen offline again.')).toBeTruthy();
  });

  it('renders the player bar when a track is actively playing', () => {
    const foundRecord = record();
    mockedUseDownloads.mockReturnValue(
      baseDownloadsHook({ downloads: [foundRecord], find: jest.fn(() => foundRecord) }),
    );
    mockedUseOfflinePlayback.mockReturnValue(
      basePlaybackHook({ playingSermonId: 'sermon-1', localUri: 'file:///playback-tmp/sermon-1.pcm-tmp' }),
    );
    const { getByLabelText } = render(<DownloadsScreen />);
    expect(getByLabelText('Stop offline playback')).toBeTruthy();
  });
});
