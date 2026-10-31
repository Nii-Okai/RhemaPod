import { act, renderHook, waitFor } from '@testing-library/react-native';
import { api } from '../../../api/typedClient';
import { ApiError } from '../../../api/errors';
import {
  useAddPlaylistItem,
  useCreatePlaylist,
  useDeletePlaylist,
  usePlaylist,
  usePlaylists,
  useRemovePlaylistItem,
  useReorderPlaylistItems,
  useUpdatePlaylist,
  useUpdatePlaylistCover,
} from '../usePlaylists';
import { queryKeys } from '../../queryClient';
import { createTestQueryClient, wrapWithQueryClient } from '../../testUtils';

jest.mock('../../../api/typedClient', () => ({
  api: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), put: jest.fn(), delete: jest.fn() },
}));

const mockedGet = api.get as jest.Mock;
const mockedPost = api.post as jest.Mock;
const mockedPatch = api.patch as jest.Mock;
const mockedPut = api.put as jest.Mock;
const mockedDelete = api.delete as jest.Mock;

const playlist = {
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
};

const detail = { ...playlist, items: [] };

beforeEach(() => {
  mockedGet.mockReset();
  mockedPost.mockReset();
  mockedPatch.mockReset();
  mockedPut.mockReset();
  mockedDelete.mockReset();
});

describe('usePlaylists', () => {
  it('calls GET /playlists', async () => {
    mockedGet.mockResolvedValue([playlist]);
    const { result } = renderHook(() => usePlaylists(), { wrapper: wrapWithQueryClient() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedGet).toHaveBeenCalledWith('/playlists', expect.objectContaining({ init: expect.anything() }));
    expect(result.current.data).toEqual([playlist]);
  });

  it('surfaces a fetch-boundary failure as an error state', async () => {
    mockedGet.mockRejectedValue(new ApiError(500, 'Something went wrong. Try again.'));
    const { result } = renderHook(() => usePlaylists(), { wrapper: wrapWithQueryClient() });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe('usePlaylist', () => {
  it('calls GET /playlists/{playlist_id} with the given id', async () => {
    mockedGet.mockResolvedValue(detail);
    const { result } = renderHook(() => usePlaylist('p1'), { wrapper: wrapWithQueryClient() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedGet).toHaveBeenCalledWith(
      '/playlists/{playlist_id}',
      expect.objectContaining({ params: { path: { playlist_id: 'p1' } } }),
    );
  });

  it('is disabled when no id is given yet', () => {
    const { result } = renderHook(() => usePlaylist(undefined), { wrapper: wrapWithQueryClient() });
    expect(result.current.fetchStatus).toBe('idle');
    expect(mockedGet).not.toHaveBeenCalled();
  });
});

describe('useCreatePlaylist', () => {
  it('POSTs /playlists and prepends the new playlist to the cached list', async () => {
    const client = createTestQueryClient();
    mockedGet.mockResolvedValue([]);
    // An observer keeps the list cache entry alive (test gcTime is 0) — same
    // workaround `useProfile.test.ts` documents for its own profile cache.
    renderHook(() => usePlaylists(), { wrapper: wrapWithQueryClient(client) });
    await waitFor(() => expect(client.getQueryData(queryKeys.playlists.list())).toEqual([]));
    mockedPost.mockResolvedValue(playlist);

    const { result } = renderHook(() => useCreatePlaylist(), { wrapper: wrapWithQueryClient(client) });
    await act(async () => {
      await result.current.mutateAsync({ name: 'Morning Dew' });
    });

    expect(mockedPost).toHaveBeenCalledWith('/playlists', {
      body: { name: 'Morning Dew', description: null, is_public: false },
    });
    expect(client.getQueryData(queryKeys.playlists.list())).toEqual([playlist]);
  });
});

describe('useUpdatePlaylist', () => {
  it('PATCHes only the fields actually passed', async () => {
    mockedPatch.mockResolvedValue({ ...playlist, is_public: false });
    const { result } = renderHook(() => useUpdatePlaylist('p1'), { wrapper: wrapWithQueryClient() });

    await act(async () => {
      await result.current.mutateAsync({ isPublic: false });
    });

    expect(mockedPatch).toHaveBeenCalledWith('/playlists/{playlist_id}', {
      params: { path: { playlist_id: 'p1' } },
      body: { is_public: false },
    });
  });

  it('updates both the list cache entry and the detail cache', async () => {
    const client = createTestQueryClient();
    mockedGet.mockImplementation((path: string) => Promise.resolve(path === '/playlists' ? [playlist] : detail));
    // Observers keep both cache entries alive (test gcTime is 0).
    renderHook(() => usePlaylists(), { wrapper: wrapWithQueryClient(client) });
    renderHook(() => usePlaylist('p1'), { wrapper: wrapWithQueryClient(client) });
    await waitFor(() => expect(client.getQueryData(queryKeys.playlists.list())).toEqual([playlist]));
    await waitFor(() => expect(client.getQueryData(queryKeys.playlists.detail('p1'))).toEqual(detail));
    const renamed = { ...playlist, name: 'Renamed' };
    mockedPatch.mockResolvedValue(renamed);

    const { result } = renderHook(() => useUpdatePlaylist('p1'), { wrapper: wrapWithQueryClient(client) });
    await act(async () => {
      await result.current.mutateAsync({ name: 'Renamed' });
    });

    expect(client.getQueryData(queryKeys.playlists.list())).toEqual([renamed]);
    expect((client.getQueryData(queryKeys.playlists.detail('p1')) as typeof detail).name).toBe('Renamed');
  });
});

describe('useDeletePlaylist', () => {
  it('DELETEs the playlist and removes it from the cached list', async () => {
    const client = createTestQueryClient();
    mockedGet.mockResolvedValue([playlist]);
    renderHook(() => usePlaylists(), { wrapper: wrapWithQueryClient(client) });
    await waitFor(() => expect(client.getQueryData(queryKeys.playlists.list())).toEqual([playlist]));
    mockedDelete.mockResolvedValue(undefined);

    const { result } = renderHook(() => useDeletePlaylist(), { wrapper: wrapWithQueryClient(client) });
    await act(async () => {
      await result.current.mutateAsync('p1');
    });

    expect(mockedDelete).toHaveBeenCalledWith('/playlists/{playlist_id}', { params: { path: { playlist_id: 'p1' } } });
    expect(client.getQueryData(queryKeys.playlists.list())).toEqual([]);
  });
});

describe('useAddPlaylistItem', () => {
  it('POSTs the sermon id and writes the refreshed detail into the cache', async () => {
    const client = createTestQueryClient();
    // An observer keeps the detail cache entry alive past the mutation's own write
    // (test gcTime is 0 — without this, a cache entry with no observer can be
    // garbage-collected before the assertion below reads it back).
    mockedGet.mockResolvedValue(detail);
    renderHook(() => usePlaylist('p1'), { wrapper: wrapWithQueryClient(client) });
    await waitFor(() => expect(client.getQueryData(queryKeys.playlists.detail('p1'))).toEqual(detail));

    const refreshed = { ...detail, item_count: 1 };
    mockedPost.mockResolvedValue(refreshed);

    const { result } = renderHook(() => useAddPlaylistItem('p1'), { wrapper: wrapWithQueryClient(client) });
    await act(async () => {
      await result.current.mutateAsync('sermon-1');
    });

    expect(mockedPost).toHaveBeenCalledWith('/playlists/{playlist_id}/items', {
      params: { path: { playlist_id: 'p1' } },
      body: { sermon_id: 'sermon-1' },
    });
    expect(client.getQueryData(queryKeys.playlists.detail('p1'))).toEqual(refreshed);
  });
});

describe('useRemovePlaylistItem', () => {
  it('DELETEs by item id, not sermon id', async () => {
    mockedDelete.mockResolvedValue(detail);
    const { result } = renderHook(() => useRemovePlaylistItem('p1'), { wrapper: wrapWithQueryClient() });

    await act(async () => {
      await result.current.mutateAsync('item-1');
    });

    expect(mockedDelete).toHaveBeenCalledWith('/playlists/{playlist_id}/items/{item_id}', {
      params: { path: { playlist_id: 'p1', item_id: 'item-1' } },
    });
  });
});

describe('useReorderPlaylistItems', () => {
  it('PUTs the full reordered id list', async () => {
    mockedPut.mockResolvedValue(detail);
    const { result } = renderHook(() => useReorderPlaylistItems('p1'), { wrapper: wrapWithQueryClient() });

    await act(async () => {
      await result.current.mutateAsync(['b', 'a']);
    });

    expect(mockedPut).toHaveBeenCalledWith('/playlists/{playlist_id}/items/order', {
      params: { path: { playlist_id: 'p1' } },
      body: { item_ids: ['b', 'a'] },
    });
  });
});

describe('useUpdatePlaylistCover', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('tickets, PUTs the blob directly to storage, confirms, and caches the cover url', async () => {
    const client = createTestQueryClient();
    mockedGet.mockImplementation((path: string) => Promise.resolve(path === '/playlists' ? [playlist] : detail));
    // Observers keep both cache entries alive (test gcTime is 0).
    renderHook(() => usePlaylists(), { wrapper: wrapWithQueryClient(client) });
    renderHook(() => usePlaylist('p1'), { wrapper: wrapWithQueryClient(client) });
    await waitFor(() => expect(client.getQueryData(queryKeys.playlists.list())).toEqual([playlist]));
    await waitFor(() => expect(client.getQueryData(queryKeys.playlists.detail('p1'))).toEqual(detail));

    mockedPost.mockImplementation((path: string) => {
      if (path === '/playlists/{playlist_id}/cover/upload-ticket') {
        return Promise.resolve({
          upload_url: 'https://storage.example/cover',
          headers: { 'Content-Type': 'image/jpeg' },
          expires_in: 300,
          cover_key: 'playlist_covers/p1/x.jpg',
        });
      }
      return Promise.resolve({ cover_url: 'https://cdn.example/cover.jpg' });
    });

    const fakeBlob = {};
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({ blob: () => Promise.resolve(fakeBlob) }) // fetch(asset.uri)
      .mockResolvedValueOnce({ ok: true }) as unknown as typeof fetch; // the direct-to-storage PUT

    const { result } = renderHook(() => useUpdatePlaylistCover('p1'), { wrapper: wrapWithQueryClient(client) });
    await act(async () => {
      await result.current.mutateAsync({ uri: 'file://cover.jpg', contentType: 'image/jpeg', filename: 'cover.jpg' });
    });

    expect(mockedPost).toHaveBeenCalledWith('/playlists/{playlist_id}/cover/confirm', {
      params: { path: { playlist_id: 'p1' }, query: { cover_key: 'playlist_covers/p1/x.jpg' } },
    });
    expect((client.getQueryData(queryKeys.playlists.detail('p1')) as typeof detail).cover_url).toBe(
      'https://cdn.example/cover.jpg',
    );
    expect((client.getQueryData(queryKeys.playlists.list()) as (typeof playlist)[])[0]!.cover_url).toBe(
      'https://cdn.example/cover.jpg',
    );
  });
});
