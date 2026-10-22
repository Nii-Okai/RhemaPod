import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { SignatureLibraryScreen } from '../SignatureLibrary';
import { ThemeProvider } from '../../../../../theme/ThemeContext';
import { useDownloads } from '../../../../../lib/downloads/useDownloads';
import { useDeletePlaylist, usePlaylists } from '../../../../../lib/query/hooks/usePlaylists';
import { useContinueWatching } from '../../../../../lib/query/hooks/useContinueWatching';
import type { DownloadRecord } from '../../../../../lib/downloads/types';
import type { PlaylistPublic } from '../../../../../lib/query/hooks/usePlaylists';
import type { ContinueWatchingItem } from '../../../../../lib/query/hooks/useContinueWatching';

// Explicit factory (not a bare automock) — an automock still has to `require()` the real
// module first to learn its shape, which for `useDownloads` pulls in `downloadManager.ts`
// -> `modules/rpa-crypto` -> the real native module resolution (unavailable under Jest,
// same gap as every other native-module test in this task).
jest.mock('../../../../../lib/downloads/useDownloads', () => ({ useDownloads: jest.fn() }));
jest.mock('../../../../../lib/query/hooks/usePlaylists', () => ({ usePlaylists: jest.fn(), useDeletePlaylist: jest.fn() }));
jest.mock('../../../../../lib/query/hooks/useContinueWatching', () => ({ useContinueWatching: jest.fn() }));

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('@expo/vector-icons');

const mockLoadTheme = jest.fn(() => Promise.resolve('dark'));
jest.mock('../../../../../lib/settings/themePreference', () => ({
  DEFAULT_THEME_PREFERENCE: 'system',
  loadThemePreference: () => mockLoadTheme(),
  saveThemePreference: jest.fn(() => Promise.resolve()),
}));

const mockedUseDownloads = useDownloads as jest.Mock;
const mockedUsePlaylists = usePlaylists as jest.Mock;
const mockedUseDeletePlaylist = useDeletePlaylist as jest.Mock;
const mockedUseContinueWatching = useContinueWatching as jest.Mock;

function record(overrides: Partial<DownloadRecord> = {}): DownloadRecord {
  return {
    sermonId: 'sermon-1',
    title: 'A Great Sermon',
    thumbnailUrl: null,
    thumbnailPath: null,
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

function playlist(overrides: Partial<PlaylistPublic> = {}): PlaylistPublic {
  return {
    id: 'playlist-1',
    name: 'Morning Dew',
    description: null,
    is_public: true,
    cover_url: null,
    owner_name: 'Nii Okai',
    item_count: 3,
    total_duration_seconds: 720,
    created_at: '2026-10-10T00:00:00Z',
    updated_at: null,
    ...overrides,
  };
}

function continueWatchingItem(overrides: Partial<ContinueWatchingItem> = {}): ContinueWatchingItem {
  return {
    id: 'sermon-cw1',
    title: 'Anchored in the Storm',
    description: null,
    thumbnail_url: null,
    duration_seconds: 1800,
    position_seconds: 600,
    percent_complete: 33,
    speaker_id: null,
    speaker_name: null,
    category_id: null,
    category_name: null,
    series_id: null,
    series_title: null,
    episode_number: null,
    tier: 'free',
    locked: false,
    last_played_at: '2026-10-10T00:00:00Z',
    ...overrides,
  };
}

function baseContinueWatchingHook(overrides: Partial<ReturnType<typeof useContinueWatching>> = {}) {
  return {
    data: [],
    isLoading: false,
    isError: false,
    error: null,
    refetch: jest.fn(),
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

function basePlaylistsHook(overrides: Partial<ReturnType<typeof usePlaylists>> = {}) {
  return {
    data: [],
    isLoading: false,
    refetch: jest.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockedUseDownloads.mockReturnValue(baseDownloadsHook());
  mockedUsePlaylists.mockReturnValue(basePlaylistsHook());
  mockedUseContinueWatching.mockReturnValue(baseContinueWatchingHook());
  mockedUseDeletePlaylist.mockReturnValue({ mutate: jest.fn() });
});


const LibraryScreen = () => <SignatureLibraryScreen />;

describe('SignatureLibraryScreen', () => {
  it.each(['dark', 'light'] as const)('renders the tally, a playlist and a download together (%s)', async (theme) => {
    mockLoadTheme.mockImplementation(() => Promise.resolve(theme));
    mockedUsePlaylists.mockReturnValue(basePlaylistsHook({ data: [playlist()] }));
    mockedUseDownloads.mockReturnValue(baseDownloadsHook({ downloads: [record()] }));
    const screen = render(
      <ThemeProvider>
        <LibraryScreen />
      </ThemeProvider>,
    );
    await act(async () => {});

    expect(screen.getByText('Library')).toBeTruthy();
    expect(screen.getByText('1 PLAYLIST · 1 DOWNLOAD')).toBeTruthy();
    expect(screen.getByText('Morning Dew')).toBeTruthy();
    expect(screen.getByText('PLAYLIST · 3 ITEMS · 12 MIN')).toBeTruthy();
    expect(screen.getByText('A Great Sermon')).toBeTruthy();
    expect(screen.getByText('TEACHING · 5.0 MB')).toBeTruthy();
    expect(screen.getByTestId('download-ready-checkmark')).toBeTruthy();
  });

  it('shows the empty state with a New playlist button', () => {
    const { getByText, getAllByText } = render(<LibraryScreen />);
    expect(getByText('Your library is empty. Start a playlist or download a sermon.')).toBeTruthy();
    fireEvent.press(getAllByText('New playlist')[0]!);
    expect(mockPush).toHaveBeenCalledWith('/playlist/create');
  });

  it('shows a loading state while either source is still loading', () => {
    mockedUsePlaylists.mockReturnValue(basePlaylistsHook({ isLoading: true }));
    const { getByLabelText } = render(<LibraryScreen />);
    expect(getByLabelText('Loading your library')).toBeTruthy();
  });

  it('the header + opens the create screen', () => {
    const { getByLabelText } = render(<LibraryScreen />);
    fireEvent.press(getByLabelText('New playlist'));
    expect(mockPush).toHaveBeenCalledWith('/playlist/create');
  });

  it('opens a playlist, plays a ready download and retries a failed one', () => {
    const retry = jest.fn();
    mockedUsePlaylists.mockReturnValue(basePlaylistsHook({ data: [playlist()] }));
    mockedUseDownloads.mockReturnValue(
      baseDownloadsHook({
        downloads: [
          record(),
          record({ sermonId: 'sermon-2', title: 'Broken', state: 'failed', failureMessage: 'Could not reach the server.' }),
        ],
        retry,
      }),
    );
    const { getByText, getByLabelText } = render(<LibraryScreen />);

    fireEvent.press(getByText('Morning Dew'));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/playlist/[id]', params: { id: 'playlist-1' } });

    fireEvent.press(getByLabelText('Play A Great Sermon offline'));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/player/[id]', params: { id: 'sermon-1' } });

    expect(getByText('Could not reach the server.')).toBeTruthy();
    fireEvent.press(getByLabelText('Retry download of Broken'));
    expect(retry).toHaveBeenCalledWith('sermon-2');
  });

  it('shows download progress and still lets an active download be cancelled', () => {
    const remove = jest.fn();
    mockedUseDownloads.mockReturnValue(baseDownloadsHook({ downloads: [record({ state: 'downloading', progress: 0.42 })], remove }));
    const { getByText, getByLabelText } = render(<LibraryScreen />);

    expect(getByText('DOWNLOADING… 42%')).toBeTruthy();
    fireEvent.press(getByLabelText('A Great Sermon'));
    expect(mockPush).not.toHaveBeenCalled();

    fireEvent(getByLabelText('A Great Sermon'), 'longPress');
    expect(getByText('Delete this download?')).toBeTruthy();
    fireEvent.press(getByText('Delete'));
    expect(remove).toHaveBeenCalledWith('sermon-1');
  });

  it('long-press and the screen-reader action both delete a playlist', () => {
    const mutate = jest.fn();
    mockedUseDeletePlaylist.mockReturnValue({ mutate });
    mockedUsePlaylists.mockReturnValue(basePlaylistsHook({ data: [playlist()] }));
    const { getByLabelText, getByText } = render(<LibraryScreen />);

    const row = getByLabelText('Morning Dew, playlist, 3 items · 12 min');
    fireEvent(row, 'longPress');
    expect(getByText('Delete this playlist?')).toBeTruthy();
    fireEvent.press(getByText('Delete'));
    expect(mutate).toHaveBeenCalledWith('playlist-1');

    fireEvent(row, 'accessibilityAction', { nativeEvent: { actionName: 'delete' } });
    expect(mutate).toHaveBeenCalledTimes(2);
  });

  it('filters with the segmented control, showing counts', () => {
    mockedUsePlaylists.mockReturnValue(basePlaylistsHook({ data: [playlist()] }));
    mockedUseDownloads.mockReturnValue(baseDownloadsHook({ downloads: [record()] }));
    const { getByLabelText, getByText, queryByText } = render(<LibraryScreen />);

    fireEvent.press(getByLabelText('Playlists, 1'));
    expect(getByText('Morning Dew')).toBeTruthy();
    expect(queryByText('A Great Sermon')).toBeNull();

    fireEvent.press(getByLabelText('Downloaded, 1'));
    expect(queryByText('Morning Dew')).toBeNull();
    expect(getByText('A Great Sermon')).toBeTruthy();

    fireEvent.press(getByLabelText('All'));
    expect(getByText('Morning Dew')).toBeTruthy();
    expect(getByText('A Great Sermon')).toBeTruthy();
  });

  it('a filter with nothing in it explains itself', () => {
    mockedUsePlaylists.mockReturnValue(basePlaylistsHook({ data: [playlist()] }));
    const { getByLabelText, getByText } = render(<LibraryScreen />);
    fireEvent.press(getByLabelText('Downloaded, 0'));
    expect(getByText('Download a sermon from its page to watch or listen offline.')).toBeTruthy();
  });

  it('searches the combined list and clears the search on close', () => {
    mockedUsePlaylists.mockReturnValue(basePlaylistsHook({ data: [playlist({ name: 'Morning Dew' }), playlist({ id: 'p2', name: 'Evening Calm' })] }));
    mockedUseDownloads.mockReturnValue(baseDownloadsHook({ downloads: [record({ title: 'Morning Glory' })] }));
    const { getByLabelText, getByText, queryByText } = render(<LibraryScreen />);

    fireEvent.press(getByLabelText('Search your library'));
    fireEvent.changeText(getByLabelText('Search your library'), 'morning');
    expect(getByText('Morning Dew')).toBeTruthy();
    expect(getByText('Morning Glory')).toBeTruthy();
    expect(queryByText('Evening Calm')).toBeNull();

    fireEvent.press(getByLabelText('Close search'));
    expect(getByText('Evening Calm')).toBeTruthy();
  });

  it('sorts through the sort sheet', () => {
    mockedUsePlaylists.mockReturnValue(basePlaylistsHook({ data: [playlist({ id: 'a', name: 'Apple', created_at: '2026-01-01T00:00:00Z' })] }));
    mockedUseDownloads.mockReturnValue(
      baseDownloadsHook({ downloads: [record({ sermonId: 'z', title: 'Zebra', updatedAt: new Date('2026-06-01T00:00:00Z').getTime() })] }),
    );
    const { getByLabelText, getByText, getAllByText } = render(<LibraryScreen />);

    expect(getAllByText(/^(Zebra|Apple)$/)[0]!.props.children).toBe('Zebra');
    fireEvent.press(getByLabelText('Sort by Recents'));
    fireEvent.press(getByText('Alphabetical'));
    expect(getAllByText(/^(Zebra|Apple)$/)[0]!.props.children).toBe('Apple');
    expect(getByText('ALPHABETICAL')).toBeTruthy();
  });

  it('switches to the grid and back, keeping actions and delete', () => {
    const remove = jest.fn();
    mockedUsePlaylists.mockReturnValue(basePlaylistsHook({ data: [playlist()] }));
    mockedUseDownloads.mockReturnValue(baseDownloadsHook({ downloads: [record()], remove }));
    const { getByLabelText, getByText } = render(<LibraryScreen />);

    fireEvent.press(getByLabelText('Grid view'));
    expect(getByText('3 ITEMS')).toBeTruthy();
    fireEvent.press(getByLabelText('Morning Dew, playlist, 3 items · 12 min'));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/playlist/[id]', params: { id: 'playlist-1' } });

    fireEvent(getByLabelText('Play A Great Sermon offline'), 'longPress');
    fireEvent.press(getByText('Delete'));
    expect(remove).toHaveBeenCalledWith('sermon-1');

    fireEvent.press(getByLabelText('List view'));
    expect(getByText('PLAYLIST · 3 ITEMS · 12 MIN')).toBeTruthy();
  });

  it('shows the resume shelf only when something is in progress, and opens the sermon', () => {
    const { queryByText, rerender, getByText, getByLabelText } = render(<LibraryScreen />);
    expect(queryByText('Pick up where you left off')).toBeNull();

    mockedUseContinueWatching.mockReturnValue(baseContinueWatchingHook({ data: [continueWatchingItem()] }));
    rerender(<LibraryScreen />);
    expect(getByText('Pick up where you left off')).toBeTruthy();
    fireEvent.press(getByLabelText('Anchored in the Storm, 20:00 left'));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/sermon/[id]', params: { id: 'sermon-cw1' } });
  });

  it('shows the resume shelf loading and error states', () => {
    mockedUseContinueWatching.mockReturnValue(baseContinueWatchingHook({ isLoading: true }));
    const { getByLabelText, rerender, getByText } = render(<LibraryScreen />);
    expect(getByLabelText('Loading continue watching')).toBeTruthy();

    mockedUseContinueWatching.mockReturnValue(baseContinueWatchingHook({ isError: true, error: new Error('boom') }));
    rerender(<LibraryScreen />);
    expect(getByText('Pick up where you left off')).toBeTruthy();
  });
});
