import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClientProvider } from '@tanstack/react-query';
import PlaylistDetailScreen from '../[id]';
import { api } from '../../../lib/api/typedClient';
import { createTestQueryClient } from '../../../lib/query/testUtils';

jest.mock('../../../lib/api/typedClient', () => ({
  api: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), put: jest.fn(), delete: jest.fn() },
}));

jest.mock('@expo/vector-icons');

// `PlaylistOptionsSheet` now sequences "close this sheet, then open the next" off
// `Sheet`'s own `onDismiss` (real iOS behavior — see that component's own doc comment
// for why a guessed delay wasn't reliable), which real RN's `Modal` only fires through
// a native bridge event `react-test-renderer` never simulates. This stand-in fires
// `onDismiss` itself the render after `visible` flips true -> false, same as the real
// native dismiss eventually does, so a test can press straight through "More options" ->
// "Name & details" without an artificial wait for an event that would otherwise never
// come under Jest.
jest.mock('react-native', () => {
  // Not `{ ...RN, Modal: MockModal }` — spreading forces every one of react-native's
  // own lazily-`get`-defined exports to evaluate eagerly, including native modules
  // (`Settings` et al.) that don't exist under Jest and throw on touch.
  // `Object.defineProperty` overrides only the one property actually being replaced.
  const RN = jest.requireActual('react-native');
  const ReactActual = require('react');
  // Renders a real host `View` regardless of `visible` (carrying `testID` through) —
  // RNTL's own internal host-component-name detection renders a bare
  // `<Modal testID="modal" />` with no `visible`/children at all and needs to find a
  // host element by that testID, which a mock returning `null` when not visible can't
  // satisfy.
  function MockModal({
    visible,
    onDismiss,
    children,
    testID,
  }: {
    visible?: boolean;
    onDismiss?: () => void;
    children?: React.ReactNode;
    testID?: string;
  }) {
    const prevVisible = ReactActual.useRef(visible);
    ReactActual.useEffect(() => {
      if (prevVisible.current && !visible) onDismiss?.();
      prevVisible.current = visible;
    }, [visible, onDismiss]);
    return ReactActual.createElement(RN.View, { testID }, visible ? children : null);
  }
  Object.defineProperty(RN, 'Modal', { value: MockModal, configurable: true, enumerable: true });
  return RN;
});

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const mockPush = jest.fn();
const mockBack = jest.fn();
let mockParams: Record<string, string | undefined> = { id: 'p1' };
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: mockBack, replace: jest.fn() }),
  useLocalSearchParams: () => mockParams,
  // No-op: `usePlaylistPreview`'s focus/blur pause isn't under test here — same
  // reasoning as mocking `useDownloads` below, this just keeps the real hook (which
  // needs a navigation container this test never mounts) from throwing.
  useFocusEffect: () => {},
  Stack: { Screen: () => null },
}));

jest.mock('react-native-share', () => ({ __esModule: true, default: { open: jest.fn() } }));

// `usePlaylistPreview`'s inline audio preview pulls in `expo-video` — same manual mock
// (a fake player/event-emitter, no native decoder) the real Player screen's own tests
// already use, swapped in here since this screen now creates one too.
jest.mock('expo-video');

// `AddToPlaylistSheet`'s Downloaded tab pulls in `useDownloads`, which pulls in
// `downloadManager.ts` and from there the native `RpaCrypto` module — not present
// under Jest. Mocked at the module boundary, same as `library.test.tsx` already
// does, rather than letting the native require blow up the whole suite.
jest.mock('../../../lib/downloads/useDownloads', () => ({
  useDownloads: () => ({ downloads: [], isLoading: false }),
}));

// Explicit factory, not a bare automock — `PlaylistCoverPicker` imports this at module
// scope, and the real module ships ESM the Jest transform doesn't handle. Mirrors
// `me.test.tsx`'s own mock for `ProfileAvatarPicker`. No test here exercises an actual pick.
jest.mock('expo-image-picker', () => ({
  requestCameraPermissionsAsync: jest.fn(async () => ({ granted: true })),
  requestMediaLibraryPermissionsAsync: jest.fn(async () => ({ granted: true })),
  launchCameraAsync: jest.fn(async () => ({ canceled: true, assets: [] })),
  launchImageLibraryAsync: jest.fn(async () => ({ canceled: true, assets: [] })),
}));

const mockedGet = api.get as jest.Mock;
const mockedPost = api.post as jest.Mock;
const mockedPatch = api.patch as jest.Mock;
const mockedDelete = api.delete as jest.Mock;

function renderScreen() {
  const client = createTestQueryClient();
  return render(
    <QueryClientProvider client={client}>
      <PlaylistDetailScreen />
    </QueryClientProvider>,
  );
}

const sermon = {
  id: 'sermon-1',
  title: 'Anchored in the Storm',
  description: null,
  thumbnail_url: null,
  duration_seconds: 125,
  speaker_id: null,
  speaker_name: 'Ada Nwosu',
  category_id: null,
  category_name: null,
  series_id: null,
  series_title: null,
  episode_number: null,
  tier: 'FREE',
  locked: false,
};

function detail(overrides: Record<string, unknown> = {}) {
  return {
    id: 'p1',
    name: 'Morning Dew',
    description: null,
    is_public: true,
    cover_url: null,
    owner_name: 'Nii Okai',
    item_count: 0,
    total_duration_seconds: 0,
    created_at: '2026-10-10T00:00:00Z',
    updated_at: null,
    items: [],
    ...overrides,
  };
}

/** `api.get` is one shared mock across every GET this screen fires — the
 * playlist detail read (`/playlists/{playlist_id}`) and the Recommended
 * section's own `/me/recommended` read need different response shapes, so
 * this keys off the requested path rather than a single `mockResolvedValue`
 * answering both the same way. */
function mockPlaylistGet(playlistDetail: ReturnType<typeof detail>, recommended: unknown[] = []) {
  mockedGet.mockImplementation((path: string) =>
    Promise.resolve(path === '/me/recommended' ? recommended : playlistDetail),
  );
}

beforeEach(() => {
  mockedGet.mockReset();
  mockedPost.mockReset();
  mockedPatch.mockReset();
  mockedDelete.mockReset();
  mockPush.mockClear();
  mockBack.mockClear();
  mockParams = { id: 'p1' };
});

describe('PlaylistDetailScreen', () => {
  it('shows the header info with no "No sermons yet" placeholder when the playlist is empty', async () => {
    mockPlaylistGet(detail());
    const { findByText, queryByText } = renderScreen();

    expect(await findByText('Morning Dew')).toBeTruthy();
    expect(await findByText('Nii Okai')).toBeTruthy();
    expect(await findByText('Public playlist · 0 min')).toBeTruthy();
    expect(queryByText('No sermons yet')).toBeNull();
  });

  it('renders each item and navigates to the player on tap', async () => {
    mockPlaylistGet(
      detail({
        item_count: 1,
        total_duration_seconds: 125,
        items: [{ id: 'item-1', position: 0, added_at: '2026-10-10T00:00:00Z', sermon }],
      }),
    );
    const { findByText } = renderScreen();

    const row = await findByText('Anchored in the Storm');
    fireEvent.press(row);
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/player/[id]', params: { id: 'sermon-1' } });
  });

  it('removing an item calls DELETE with the item id, not the sermon id', async () => {
    mockPlaylistGet(
      detail({
        item_count: 1,
        items: [{ id: 'item-1', position: 0, added_at: '2026-10-10T00:00:00Z', sermon }],
      }),
    );
    mockedDelete.mockResolvedValue(detail());
    const { findByTestId } = renderScreen();

    const row = await findByTestId('playlist-item-row-item-1');
    fireEvent(row, 'accessibilityAction', { nativeEvent: { actionName: 'delete' } });

    await waitFor(() =>
      expect(mockedDelete).toHaveBeenCalledWith('/playlists/{playlist_id}/items/{item_id}', {
        params: { path: { playlist_id: 'p1', item_id: 'item-1' } },
      }),
    );
  });

  it('opens Name & details from the options menu and deletes the playlist', async () => {
    mockPlaylistGet(detail());
    mockedDelete.mockResolvedValue(undefined);
    const { findByLabelText, getByLabelText } = renderScreen();

    fireEvent.press(await findByLabelText('More options'));
    fireEvent.press(getByLabelText('Name & details'));
    // `PlaylistOptionsSheet` delays opening the next sheet until its own has closed
    // (see its own doc comment — two native `Modal`s flipping visible in the same tick
    // freezes iOS), so the details sheet isn't up yet on this same synchronous tick.
    fireEvent.press(await findByLabelText('Delete playlist'));
    fireEvent.press(getByLabelText('Delete'));

    await waitFor(() =>
      expect(mockedDelete).toHaveBeenCalledWith('/playlists/{playlist_id}', { params: { path: { playlist_id: 'p1' } } }),
    );
    expect(mockBack).toHaveBeenCalled();
  });

  it('toggles privacy from the Name & details sheet', async () => {
    mockPlaylistGet(detail());
    mockedPatch.mockResolvedValue(detail({ is_public: false }));
    const { findByLabelText, getByLabelText } = renderScreen();

    fireEvent.press(await findByLabelText('More options'));
    fireEvent.press(getByLabelText('Name & details'));
    fireEvent.press(await findByLabelText('Make private'));

    await waitFor(() =>
      expect(mockedPatch).toHaveBeenCalledWith('/playlists/{playlist_id}', {
        params: { path: { playlist_id: 'p1' } },
        body: { is_public: false },
      }),
    );
  });

  it('shows a plain back chevron (no native header) that navigates back', async () => {
    mockPlaylistGet(detail());
    const { findByLabelText } = renderScreen();

    fireEvent.press(await findByLabelText('Back'));
    expect(mockBack).toHaveBeenCalled();
  });

  it('"Add to this playlist" opens the Add sheet', async () => {
    mockPlaylistGet(detail());
    const { findByLabelText } = renderScreen();

    fireEvent.press(await findByLabelText('Add to this playlist'));
    expect(await findByLabelText('Search sermons')).toBeTruthy();
  });

  it('shares via the icon row\'s own Share icon, not just the options sheet', async () => {
    mockPlaylistGet(detail());
    const { findByLabelText } = renderScreen();

    expect(await findByLabelText('Share')).toBeTruthy();
  });
});

describe('PlaylistDetailScreen — Recommended sermons', () => {
  const recommended = {
    id: 'rec-1',
    title: 'Faith Over Fear',
    description: null,
    thumbnail_url: null,
    duration_seconds: 900,
    speaker_id: null,
    speaker_name: null,
    category_id: null,
    category_name: null,
    series_id: null,
    series_title: null,
    episode_number: null,
    tier: 'free',
    locked: false,
  };

  it('is omitted entirely when there is nothing to recommend', async () => {
    mockPlaylistGet(detail(), []);
    const { findByText, queryByText } = renderScreen();

    await findByText('Morning Dew');
    expect(queryByText('Recommended sermons')).toBeNull();
  });

  it('renders recommended sermons and adds one on tap', async () => {
    mockPlaylistGet(detail(), [recommended]);
    mockedPost.mockResolvedValue(detail({ item_count: 1 }));
    const { findByText, getByLabelText } = renderScreen();

    expect(await findByText('Recommended sermons')).toBeTruthy();
    expect(await findByText('Faith Over Fear')).toBeTruthy();

    fireEvent.press(getByLabelText('Add Faith Over Fear'));

    await waitFor(() =>
      expect(mockedPost).toHaveBeenCalledWith('/playlists/{playlist_id}/items', {
        params: { path: { playlist_id: 'p1' } },
        body: { sermon_id: 'rec-1' },
      }),
    );
  });

  it('filters out a recommended sermon already in the playlist, rather than showing it disabled', async () => {
    mockPlaylistGet(
      detail({
        item_count: 1,
        items: [{ id: 'item-1', position: 0, added_at: '2026-10-10T00:00:00Z', sermon: { ...recommended, id: 'rec-1' } }],
      }),
      [recommended],
    );
    const { findByText, queryByText } = renderScreen();

    await findByText('Morning Dew');
    expect(queryByText('Recommended sermons')).toBeNull();
  });
});

describe('PlaylistDetailScreen — Play/Shuffle', () => {
  const twoItems = [
    { id: 'item-1', position: 0, added_at: '2026-10-10T00:00:00Z', sermon: { ...sermon, id: 'sermon-1' } },
    { id: 'item-2', position: 1, added_at: '2026-10-10T00:00:00Z', sermon: { ...sermon, id: 'sermon-2', title: 'Second' } },
  ];

  it('hides Play/Shuffle for an empty playlist', async () => {
    mockPlaylistGet(detail());
    const { findByText, queryByLabelText } = renderScreen();

    await findByText('Morning Dew');
    expect(queryByLabelText('Play this playlist')).toBeNull();
    expect(queryByLabelText('Shuffle play this playlist')).toBeNull();
  });

  it('Play opens the Player on the first item, queued through the rest in order', async () => {
    mockPlaylistGet(detail({ item_count: 2, items: twoItems }));
    const { findByLabelText } = renderScreen();

    fireEvent.press(await findByLabelText('Play this playlist'));

    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/player/[id]',
      params: { id: 'sermon-1', playlistId: 'p1', queue: 'sermon-1,sermon-2', queueIndex: '0' },
    });
  });

  it('Shuffle opens the Player queued on every item, in some order', async () => {
    mockPlaylistGet(detail({ item_count: 2, items: twoItems }));
    const { findByLabelText } = renderScreen();

    fireEvent.press(await findByLabelText('Shuffle play this playlist'));

    expect(mockPush).toHaveBeenCalledTimes(1);
    const call = mockPush.mock.calls[0][0];
    expect(call.pathname).toBe('/player/[id]');
    expect(call.params.playlistId).toBe('p1');
    expect(call.params.queueIndex).toBe('0');
    expect(call.params.queue.split(',').sort()).toEqual(['sermon-1', 'sermon-2']);
    expect(call.params.id).toBe(call.params.queue.split(',')[0]);
  });
});
