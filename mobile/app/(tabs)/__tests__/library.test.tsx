import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import LibraryScreen from '../library';
import { useDownloads } from '../../../lib/downloads/useDownloads';
import { useDeletePlaylist, usePlaylists } from '../../../lib/query/hooks/usePlaylists';
import { useContinueWatching } from '../../../lib/query/hooks/useContinueWatching';
import type { DownloadRecord } from '../../../lib/downloads/types';
import type { PlaylistPublic } from '../../../lib/query/hooks/usePlaylists';
import type { ContinueWatchingItem } from '../../../lib/query/hooks/useContinueWatching';

// Explicit factory (not a bare automock) — an automock still has to `require()` the real
// module first to learn its shape, which for `useDownloads` pulls in `downloadManager.ts`
// -> `modules/rpa-crypto` -> the real native module resolution (unavailable under Jest,
// same gap as every other native-module test in this task).
jest.mock('../../../lib/downloads/useDownloads', () => ({ useDownloads: jest.fn() }));
jest.mock('../../../lib/query/hooks/usePlaylists', () => ({ usePlaylists: jest.fn(), useDeletePlaylist: jest.fn() }));
jest.mock('../../../lib/query/hooks/useContinueWatching', () => ({ useContinueWatching: jest.fn() }));

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('@expo/vector-icons');

const mockedUseDownloads = useDownloads as jest.Mock;
const mockedUsePlaylists = usePlaylists as jest.Mock;
const mockedUseDeletePlaylist = useDeletePlaylist as jest.Mock;
const mockedUseContinueWatching = useContinueWatching as jest.Mock;

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

describe('LibraryScreen — no section headers, one combined list', () => {
  it('shows a single empty-state message when both playlists and downloads are empty', () => {
    const { getByText } = render(<LibraryScreen />);
    expect(getByText('Your library is empty. Create a playlist or download a sermon to get started.')).toBeTruthy();
  });

  it('shows a loading state while either source is still loading', () => {
    mockedUsePlaylists.mockReturnValue(basePlaylistsHook({ isLoading: true }));
    const { getByLabelText } = render(<LibraryScreen />);
    expect(getByLabelText('Loading your library')).toBeTruthy();
  });

  it('renders a playlist and a download side by side, with no section-heading text beyond the filter pills themselves', () => {
    mockedUsePlaylists.mockReturnValue(basePlaylistsHook({ data: [playlist()] }));
    mockedUseDownloads.mockReturnValue(baseDownloadsHook({ downloads: [record()] }));
    const { getByText, queryByText } = render(<LibraryScreen />);

    expect(getByText('Morning Dew')).toBeTruthy();
    expect(getByText('A Great Sermon')).toBeTruthy();
    // "Downloaded" (the pill's own label) is the only place that string appears — the old
    // bold "Downloads" section heading is gone.
    expect(queryByText('Downloads')).toBeNull();
  });

  it('singularizes a one-item playlist\'s count', () => {
    mockedUsePlaylists.mockReturnValue(basePlaylistsHook({ data: [playlist({ item_count: 1 })] }));
    const { getByText } = render(<LibraryScreen />);
    expect(getByText('1 item · 12 min')).toBeTruthy();
  });

  it('tapping a playlist pushes its detail route', () => {
    mockedUsePlaylists.mockReturnValue(basePlaylistsHook({ data: [playlist()] }));
    const { getByText } = render(<LibraryScreen />);
    fireEvent.press(getByText('Morning Dew'));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/playlist/[id]', params: { id: 'playlist-1' } });
  });

  it('tapping "New playlist" pushes the create modal', () => {
    const { getByLabelText } = render(<LibraryScreen />);
    fireEvent.press(getByLabelText('New playlist'));
    expect(mockPush).toHaveBeenCalledWith('/playlist/create');
  });

  it('a downloaded item shows a checkmark before its category; a playlist never does', () => {
    mockedUsePlaylists.mockReturnValue(basePlaylistsHook({ data: [playlist()] }));
    mockedUseDownloads.mockReturnValue(baseDownloadsHook({ downloads: [record({ state: 'downloading', progress: 0.5 })] }));
    const { queryByTestId, rerender } = render(<LibraryScreen />);
    // Mid-download: no checkmark yet (its meta line is a status message, not a category).
    expect(queryByTestId('download-ready-checkmark')).toBeNull();

    mockedUseDownloads.mockReturnValue(baseDownloadsHook({ downloads: [record({ state: 'ready' })] }));
    rerender(<LibraryScreen />);
    expect(queryByTestId('download-ready-checkmark')).toBeTruthy();
  });
});

describe('LibraryScreen — downloads', () => {
  it('renders a ready download with its thumbnail-overlay Play control and its category + size', () => {
    mockedUseDownloads.mockReturnValue(baseDownloadsHook({ downloads: [record()] }));
    const { getByText, getByLabelText } = render(<LibraryScreen />);

    expect(getByText('A Great Sermon')).toBeTruthy();
    expect(getByText('Teaching · 5.0 MB')).toBeTruthy();
    expect(getByLabelText('Play A Great Sermon offline')).toBeTruthy();
  });

  it('renders a downloading progress row', () => {
    mockedUseDownloads.mockReturnValue(
      baseDownloadsHook({ downloads: [record({ state: 'downloading', progress: 0.42, bytesTotal: null })] }),
    );
    const { getByText } = render(<LibraryScreen />);
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
    const { getByText, getByLabelText } = render(<LibraryScreen />);

    expect(getByText('Could not reach the server. Check your connection and retry.')).toBeTruthy();
    fireEvent.press(getByLabelText('Retry download of A Great Sermon'));
    expect(retry).toHaveBeenCalledWith('sermon-1');
  });

  it('pressing Play navigates into the real Player screen for that sermon', () => {
    mockedUseDownloads.mockReturnValue(baseDownloadsHook({ downloads: [record()] }));
    const { getByLabelText } = render(<LibraryScreen />);

    fireEvent.press(getByLabelText('Play A Great Sermon offline'));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/player/[id]', params: { id: 'sermon-1' } });
  });

  it('long-pressing a download row opens a delete confirm, not a swipe gesture', () => {
    const remove = jest.fn();
    mockedUseDownloads.mockReturnValue(baseDownloadsHook({ downloads: [record()], remove }));
    const { getByText, getByLabelText } = render(<LibraryScreen />);

    fireEvent(getByLabelText('Play A Great Sermon offline'), 'longPress');
    expect(getByText('Delete this download?')).toBeTruthy();

    fireEvent.press(getByLabelText('Delete'));
    expect(remove).toHaveBeenCalledWith('sermon-1');
  });

  it('a download row is still reachable by VoiceOver/TalkBack without the long-press gesture', () => {
    const remove = jest.fn();
    mockedUseDownloads.mockReturnValue(baseDownloadsHook({ downloads: [record()], remove }));
    const { getByLabelText } = render(<LibraryScreen />);

    fireEvent(getByLabelText('Play A Great Sermon offline'), 'accessibilityAction', { nativeEvent: { actionName: 'delete' } });
    expect(remove).toHaveBeenCalledWith('sermon-1');
  });

  it('an active download can still be long-press-deleted (cancelled) even though a short press is a no-op', () => {
    const remove = jest.fn();
    mockedUseDownloads.mockReturnValue(baseDownloadsHook({ downloads: [record({ state: 'downloading', progress: 0.1 })], remove }));
    const { getByText, getByLabelText } = render(<LibraryScreen />);

    fireEvent.press(getByLabelText('A Great Sermon'));
    expect(mockPush).not.toHaveBeenCalled();

    fireEvent(getByLabelText('A Great Sermon'), 'longPress');
    fireEvent.press(getByText('Delete'));
    expect(remove).toHaveBeenCalledWith('sermon-1');
  });
});

describe('LibraryScreen — header search', () => {
  it('toggling search reveals a filter field that narrows the combined list by substring', () => {
    mockedUsePlaylists.mockReturnValue(basePlaylistsHook({ data: [playlist({ name: 'Morning Dew' }), playlist({ id: 'p2', name: 'Evening Calm' })] }));
    mockedUseDownloads.mockReturnValue(baseDownloadsHook({ downloads: [record({ title: 'Morning Glory' }), record({ sermonId: 's2', title: 'Night Watch' })] }));
    const { getByLabelText, getByText, queryByText } = render(<LibraryScreen />);

    fireEvent.press(getByLabelText('Search your library'));
    fireEvent.changeText(getByLabelText('Search your library'), 'morning');

    expect(getByText('Morning Dew')).toBeTruthy();
    expect(getByText('Morning Glory')).toBeTruthy();
    expect(queryByText('Evening Calm')).toBeNull();
    expect(queryByText('Night Watch')).toBeNull();
  });

  it('closing search clears the filter', () => {
    mockedUsePlaylists.mockReturnValue(basePlaylistsHook({ data: [playlist({ name: 'Morning Dew' })] }));
    const { getByLabelText, getByText } = render(<LibraryScreen />);

    fireEvent.press(getByLabelText('Search your library'));
    fireEvent.changeText(getByLabelText('Search your library'), 'nothing matches this');
    fireEvent.press(getByLabelText('Close search'));

    expect(getByText('Morning Dew')).toBeTruthy();
  });
});

describe('LibraryScreen — filter pills', () => {
  it('selecting "Playlists" hides downloads, and vice versa; selecting the same pill again clears it', () => {
    mockedUsePlaylists.mockReturnValue(basePlaylistsHook({ data: [playlist()] }));
    mockedUseDownloads.mockReturnValue(baseDownloadsHook({ downloads: [record()] }));
    const { getByText, queryByText } = render(<LibraryScreen />);

    expect(getByText('Morning Dew')).toBeTruthy();
    expect(getByText('A Great Sermon')).toBeTruthy();

    fireEvent.press(getByText('Playlists'));
    expect(getByText('Morning Dew')).toBeTruthy();
    expect(queryByText('A Great Sermon')).toBeNull();

    fireEvent.press(getByText('Downloaded'));
    expect(queryByText('Morning Dew')).toBeNull();
    expect(getByText('A Great Sermon')).toBeTruthy();

    fireEvent.press(getByText('Downloaded'));
    expect(getByText('Morning Dew')).toBeTruthy();
    expect(getByText('A Great Sermon')).toBeTruthy();
  });
});

describe('LibraryScreen — sort', () => {
  it('opens the sort sheet and reorders the combined list alphabetically', () => {
    mockedUsePlaylists.mockReturnValue(
      basePlaylistsHook({ data: [playlist({ id: 'a', name: 'Apple', created_at: '2026-01-01T00:00:00Z' })] }),
    );
    mockedUseDownloads.mockReturnValue(
      baseDownloadsHook({ downloads: [record({ sermonId: 'z', title: 'Zebra', updatedAt: new Date('2026-06-01T00:00:00Z').getTime() })] }),
    );
    const { getByLabelText, getByText, getAllByText } = render(<LibraryScreen />);

    // Default (Recents) — the download's newer `updatedAt` puts it first.
    expect(getAllByText(/Zebra|Apple/)[0]!.props.children).toBe('Zebra');

    fireEvent.press(getByLabelText('Sort by Recents'));
    fireEvent.press(getByText('Alphabetical'));

    expect(getAllByText(/Zebra|Apple/)[0]!.props.children).toBe('Apple');
  });
});

describe('LibraryScreen — grid toggle', () => {
  it('switching to grid still renders every playlist and download, without the list-only accessibility labels', () => {
    mockedUsePlaylists.mockReturnValue(basePlaylistsHook({ data: [playlist()] }));
    mockedUseDownloads.mockReturnValue(baseDownloadsHook({ downloads: [record()] }));
    const { getByLabelText, getByText, queryByLabelText } = render(<LibraryScreen />);

    fireEvent.press(getByLabelText('Switch to grid view'));

    expect(getByText('Morning Dew')).toBeTruthy();
    expect(getByLabelText('Play A Great Sermon offline')).toBeTruthy();
    // The list row's richer accessibility label (name + subtitle) is gone — the grid
    // tile's own, plainer label (`playlist.name` alone) replaces it.
    expect(queryByLabelText(/Morning Dew, 3 items/)).toBeNull();

    fireEvent.press(getByLabelText('Switch to list view'));
    expect(queryByLabelText('Switch to list view')).toBeNull();
  });

  it('deleting a download grid tile goes through a long-press confirm, not a swipe', () => {
    const remove = jest.fn();
    mockedUseDownloads.mockReturnValue(baseDownloadsHook({ downloads: [record()], remove }));
    const { getByLabelText, getByText } = render(<LibraryScreen />);

    fireEvent.press(getByLabelText('Switch to grid view'));
    fireEvent(getByLabelText('Play A Great Sermon offline'), 'longPress');
    expect(getByText('Delete this download?')).toBeTruthy();

    fireEvent.press(getByLabelText('Delete'));
    expect(remove).toHaveBeenCalledWith('sermon-1');
  });

  it('a download grid tile is still reachable by VoiceOver/TalkBack without the long-press gesture', () => {
    const remove = jest.fn();
    mockedUseDownloads.mockReturnValue(baseDownloadsHook({ downloads: [record()], remove }));
    const { getByLabelText } = render(<LibraryScreen />);

    fireEvent.press(getByLabelText('Switch to grid view'));
    fireEvent(getByLabelText('Play A Great Sermon offline'), 'accessibilityAction', {
      nativeEvent: { actionName: 'delete' },
    });
    expect(remove).toHaveBeenCalledWith('sermon-1');
  });
});

describe('LibraryScreen — Continue watching shelf', () => {
  it('is omitted entirely when there is nothing in progress — no empty-state card', () => {
    const { queryByText } = render(<LibraryScreen />);
    expect(queryByText('continue watching')).toBeNull();
  });

  it('shows a loading state', () => {
    mockedUseContinueWatching.mockReturnValue(baseContinueWatchingHook({ isLoading: true }));
    const { getByLabelText } = render(<LibraryScreen />);
    expect(getByLabelText('Loading continue watching')).toBeTruthy();
  });

  it('renders each in-progress sermon and navigates into it on tap', () => {
    mockedUseContinueWatching.mockReturnValue(baseContinueWatchingHook({ data: [continueWatchingItem()] }));
    const { getByText } = render(<LibraryScreen />);

    fireEvent.press(getByText('Anchored in the Storm'));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/sermon/[id]', params: { id: 'sermon-cw1' } });
  });

  it('shows a retry banner on error', () => {
    const refetch = jest.fn();
    mockedUseContinueWatching.mockReturnValue(
      baseContinueWatchingHook({ isError: true, error: new Error('down'), refetch }),
    );
    const { getByText } = render(<LibraryScreen />);

    expect(getByText('Something went wrong. Try again.')).toBeTruthy();
    fireEvent.press(getByText('Retry'));
    expect(refetch).toHaveBeenCalled();
  });
});

describe('LibraryScreen — playlist long-press delete', () => {
  it('long-pressing a playlist row (list mode) opens a delete confirm and deletes by id', () => {
    const mutate = jest.fn();
    mockedUseDeletePlaylist.mockReturnValue({ mutate });
    mockedUsePlaylists.mockReturnValue(basePlaylistsHook({ data: [playlist()] }));
    const { getByText, getByLabelText } = render(<LibraryScreen />);

    fireEvent(getByLabelText('Morning Dew, 3 items · 12 min'), 'longPress');
    expect(getByText('Delete this playlist?')).toBeTruthy();

    fireEvent.press(getByLabelText('Delete'));
    expect(mutate).toHaveBeenCalledWith('playlist-1');
  });

  it('is reachable by VoiceOver/TalkBack without the long-press gesture (list mode)', () => {
    const mutate = jest.fn();
    mockedUseDeletePlaylist.mockReturnValue({ mutate });
    mockedUsePlaylists.mockReturnValue(basePlaylistsHook({ data: [playlist()] }));
    const { getByLabelText } = render(<LibraryScreen />);

    fireEvent(getByLabelText('Morning Dew, 3 items · 12 min'), 'accessibilityAction', {
      nativeEvent: { actionName: 'delete' },
    });
    expect(mutate).toHaveBeenCalledWith('playlist-1');
  });

  it('long-pressing a playlist grid tile opens a delete confirm and deletes by id', () => {
    const mutate = jest.fn();
    mockedUseDeletePlaylist.mockReturnValue({ mutate });
    mockedUsePlaylists.mockReturnValue(basePlaylistsHook({ data: [playlist()] }));
    const { getByLabelText, getByText } = render(<LibraryScreen />);

    fireEvent.press(getByLabelText('Switch to grid view'));
    fireEvent(getByLabelText('Morning Dew'), 'longPress');
    expect(getByText('Delete this playlist?')).toBeTruthy();

    fireEvent.press(getByLabelText('Delete'));
    expect(mutate).toHaveBeenCalledWith('playlist-1');
  });
});
