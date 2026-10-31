import React from 'react';
import { fireEvent, render, waitFor, within } from '@testing-library/react-native';
import { QueryClientProvider } from '@tanstack/react-query';
import PlaylistDetailScreen from '../[id]';
import { ApiError } from '../../../lib/api/errors';
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
const mockReplace = jest.fn();
let mockParams: Record<string, string | undefined> = { id: 'p1' };
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: mockBack, replace: mockReplace }),
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


const twoItems = [
  { id: 'item-1', position: 0, added_at: '2026-10-10T00:00:00Z', sermon: { ...sermon, id: 'sermon-1', category_name: 'Faith' } },
  {
    id: 'item-2',
    position: 1,
    added_at: '2026-10-10T00:00:00Z',
    sermon: { ...sermon, id: 'sermon-2', title: 'Second', series_id: 'se1', series_title: 'Divine Patterns', episode_number: 2 },
  },
];

describe('Signature playlist detail', () => {
  it('shows the cover, kicker, title and owner; an empty playlist leads with Add', async () => {
    mockPlaylistGet(detail());
    const { findByText, getByText, getByLabelText, queryByLabelText } = renderScreen();

    expect(await findByText('Morning Dew')).toBeTruthy();
    expect(getByText('PUBLIC PLAYLIST · 0 ITEMS · 0 MIN')).toBeTruthy();
    expect(getByText('Nii Okai')).toBeTruthy();
    expect(getByLabelText('Change playlist cover')).toBeTruthy();
    expect(queryByLabelText('Play this playlist')).toBeNull();
    // Shuffle stays in the action row but can't start an empty queue.
    expect(getByLabelText('Shuffle').props.accessibilityState).toEqual({ disabled: true });

    fireEvent.press(getByLabelText('Add to this playlist'));
    expect(await findByText('Add to playlist')).toBeTruthy();
    expect(getByLabelText('Search sermons')).toBeTruthy();
  });

  it('numbers the items with their category or series meta and opens one in the player', async () => {
    mockPlaylistGet(detail({ item_count: 2, items: twoItems }));
    const { findByText, getByText } = renderScreen();

    expect(await findByText('IN THIS PLAYLIST · 2')).toBeTruthy();
    expect(getByText('01')).toBeTruthy();
    expect(getByText('FAITH')).toBeTruthy();
    expect(getByText('DIVINE PATTERNS · EPISODE 2')).toBeTruthy();

    fireEvent.press(getByText('Second'));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/player/[id]', params: { id: 'sermon-2' } });
  });

  it('Play queues every item in order; Shuffle queues all of them', async () => {
    mockPlaylistGet(detail({ item_count: 2, items: twoItems }));
    const { findByLabelText, getByLabelText } = renderScreen();

    fireEvent.press(await findByLabelText('Play this playlist'));
    expect(mockPush).toHaveBeenLastCalledWith({
      pathname: '/player/[id]',
      params: { id: 'sermon-1', playlistId: 'p1', queue: 'sermon-1,sermon-2', queueIndex: '0' },
    });

    fireEvent.press(getByLabelText('Shuffle'));
    const call = mockPush.mock.calls[1][0];
    expect(call.params.queue.split(',').sort()).toEqual(['sermon-1', 'sermon-2']);
  });

  it('removes an item by its playlist-item id', async () => {
    mockPlaylistGet(detail({ item_count: 2, items: twoItems }));
    mockedDelete.mockResolvedValue(detail());
    const { findByTestId } = renderScreen();

    fireEvent(await findByTestId('playlist-item-row-item-2'), 'accessibilityAction', { nativeEvent: { actionName: 'delete' } });
    await waitFor(() =>
      expect(mockedDelete).toHaveBeenCalledWith('/playlists/{playlist_id}/items/{item_id}', {
        params: { path: { playlist_id: 'p1', item_id: 'item-2' } },
      }),
    );
  });

  it('Edit opens Name & details, and More options still reaches the same sheet', async () => {
    mockPlaylistGet(detail());
    mockedPatch.mockResolvedValue(detail({ is_public: false }));
    const { findByLabelText, getByLabelText } = renderScreen();

    fireEvent.press(await findByLabelText('Edit'));
    fireEvent.press(await findByLabelText('Make private'));
    await waitFor(() =>
      expect(mockedPatch).toHaveBeenCalledWith('/playlists/{playlist_id}', {
        params: { path: { playlist_id: 'p1' } },
        body: { is_public: false },
      }),
    );

    fireEvent.press(getByLabelText('More options'));
    expect(getByLabelText('Name & details')).toBeTruthy();
  });

  it('has Share and Back', async () => {
    mockPlaylistGet(detail());
    const { findByLabelText, getByLabelText } = renderScreen();
    expect(await findByLabelText('Share')).toBeTruthy();
    fireEvent.press(getByLabelText('Back'));
    expect(mockBack).toHaveBeenCalled();
  });

  it('adds a recommended sermon, and leaves out ones already in the playlist', async () => {
    const rec = { ...sermon, id: 'rec-1', title: 'Faith Over Fear' };
    mockPlaylistGet(detail({ item_count: 1, items: [twoItems[0]] }), [rec, { ...sermon, id: 'sermon-1' }]);
    mockedPost.mockResolvedValue(detail());
    const { findByText, getByLabelText, queryByLabelText } = renderScreen();

    expect(await findByText('Recommended sermons')).toBeTruthy();
    expect(queryByLabelText('Add Anchored in the Storm')).toBeNull();
    fireEvent.press(getByLabelText('Add Faith Over Fear'));
    await waitFor(() =>
      expect(mockedPost).toHaveBeenCalledWith('/playlists/{playlist_id}/items', {
        params: { path: { playlist_id: 'p1' } },
        body: { sermon_id: 'rec-1' },
      }),
    );
  });

  it('shows the not-available state on a 404 (a private or missing playlist), and Go home navigates to /', async () => {
    mockedGet.mockImplementation((path: string) =>
      path === '/me/recommended' ? Promise.resolve([]) : Promise.reject(new ApiError(404, 'Playlist not found')),
    );
    const { findByText, queryByText } = renderScreen();
    expect(await findByText("This playlist isn't available")).toBeTruthy();
    expect(queryByText('Try again')).toBeNull();
    fireEvent.press(await findByText('Go to Home'));
    expect(mockReplace).toHaveBeenCalledWith('/');
  });

  it('keeps the retryable error state for a non-404 failure (500)', async () => {
    mockedGet.mockImplementation((path: string) =>
      path === '/me/recommended' ? Promise.resolve([]) : Promise.reject(new ApiError(500, 'boom')),
    );
    const { findByText, queryByText } = renderScreen();
    expect(await findByText('Something went wrong loading this playlist.')).toBeTruthy();
    expect(queryByText("This playlist isn't available")).toBeNull();
  });

  it('shows the error state with a working back button', async () => {
    mockedGet.mockImplementation((path: string) =>
      path === '/me/recommended' ? Promise.resolve([]) : Promise.reject(new Error('boom')),
    );
    const { findByText, getByLabelText } = renderScreen();
    expect(await findByText('Something went wrong loading this playlist.')).toBeTruthy();
    fireEvent.press(getByLabelText('Back'));
    expect(mockBack).toHaveBeenCalled();
    // `within` imported for parity with the classic suite's helpers.
    expect(within).toBeDefined();
  });
});
