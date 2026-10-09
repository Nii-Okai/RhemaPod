import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import DownloadsScreen from '../downloads';
import { useDownloads } from '../../../lib/downloads/useDownloads';
import type { DownloadRecord } from '../../../lib/downloads/types';

// Explicit factory (not a bare automock) — an automock still has to `require()` the real
// module first to learn its shape, which for `useDownloads` pulls in `downloadManager.ts`
// -> `modules/rpa-crypto` -> the real native module resolution (unavailable under Jest,
// same gap as every other native-module test in this task).
jest.mock('../../../lib/downloads/useDownloads', () => ({ useDownloads: jest.fn() }));

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const mockedUseDownloads = useDownloads as jest.Mock;

function record(overrides: Partial<DownloadRecord> = {}): DownloadRecord {
  return {
    sermonId: 'sermon-1',
    title: 'A Great Sermon',
    thumbnailUrl: null,
    category: 'Teaching',
    mediaType: 'audio',
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

beforeEach(() => {
  jest.clearAllMocks();
});

describe('DownloadsScreen — loading/empty', () => {
  it('shows a loading state', () => {
    mockedUseDownloads.mockReturnValue(baseDownloadsHook({ isLoading: true }));
    const { getByLabelText } = render(<DownloadsScreen />);
    expect(getByLabelText('Loading downloads')).toBeTruthy();
  });

  it('shows an empty state (Isaac\'s ask, session 2026-10-09 — the Wi-Fi-only toggle, this screen\'s one setting, moved to Profile & Settings\' own Downloads section; this screen carries no settings entry point of its own anymore)', () => {
    mockedUseDownloads.mockReturnValue(baseDownloadsHook({ downloads: [] }));
    const { getByText } = render(<DownloadsScreen />);
    expect(getByText('No downloads yet')).toBeTruthy();
  });
});

describe('DownloadsScreen — populated', () => {
  it('renders a ready download with its thumbnail-overlay Play control and its category + size, not the old "Downloaded" label', () => {
    mockedUseDownloads.mockReturnValue(baseDownloadsHook({ downloads: [record()] }));
    const { getByText, getByLabelText } = render(<DownloadsScreen />);

    expect(getByText('A Great Sermon')).toBeTruthy();
    expect(getByText('Teaching · 5.0 MB')).toBeTruthy();
    expect(getByLabelText('Play A Great Sermon offline')).toBeTruthy();
  });

  it('renders a downloading progress row', () => {
    mockedUseDownloads.mockReturnValue(
      baseDownloadsHook({ downloads: [record({ state: 'downloading', progress: 0.42, bytesTotal: null })] }),
    );
    const { getByText } = render(<DownloadsScreen />);
    expect(getByText('Downloading… 42%')).toBeTruthy();
  });

  it('renders a failed download with its real reason, retried by tapping its thumbnail', () => {
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
    const { getByText, getByLabelText } = render(<DownloadsScreen />);

    expect(getByText('Could not reach the server. Check your connection and retry.')).toBeTruthy();
    fireEvent.press(getByLabelText('Retry download of A Great Sermon'));
    expect(retry).toHaveBeenCalledWith('sermon-1');
  });

  it('pressing Play navigates into the real Player screen for that sermon (audio or video alike — this list has no playback surface of its own anymore)', () => {
    mockedUseDownloads.mockReturnValue(baseDownloadsHook({ downloads: [record()] }));
    const { getByLabelText } = render(<DownloadsScreen />);

    fireEvent.press(getByLabelText('Play A Great Sermon offline'));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/player/[id]', params: { id: 'sermon-1' } });
  });

  it('deleting a ready download is reachable without the swipe gesture, via the row\'s accessible Delete action (VoiceOver/TalkBack — see SwipeToDelete\'s own doc comment)', () => {
    const remove = jest.fn();
    mockedUseDownloads.mockReturnValue(baseDownloadsHook({ downloads: [record()], remove }));
    const { getByTestId } = render(<DownloadsScreen />);

    fireEvent(getByTestId('download-row-sermon-1'), 'accessibilityAction', { nativeEvent: { actionName: 'delete' } });
    expect(remove).toHaveBeenCalledWith('sermon-1');
  });
});
