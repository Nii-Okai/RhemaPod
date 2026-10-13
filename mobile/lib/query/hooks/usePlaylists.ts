import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { api } from '../../api/typedClient';
import { queryKeys } from '../queryClient';
import type { components } from '../../api/schema';

export type PlaylistPublic = components['schemas']['PlaylistPublic'];
export type PlaylistDetail = components['schemas']['PlaylistDetail'];
export type PlaylistItemPublic = components['schemas']['PlaylistItemPublic'];

/** `GET /playlists` — the caller's own playlists, newest first (design spec: the
 * Library tab's "Playlists" section). */
export function usePlaylists() {
  return useQuery({
    queryKey: queryKeys.playlists.list(),
    queryFn: ({ signal }) => api.get('/playlists', { init: { signal } }),
  });
}

/** `GET /playlists/{id}` — one playlist's full item list, pre-filtered to what's
 * currently visible to the viewer (see the backend's own doc note on
 * `PlaylistDetail`). */
export function usePlaylist(playlistId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.playlists.detail(playlistId ?? ''),
    queryFn: ({ signal }) =>
      api.get('/playlists/{playlist_id}', { params: { path: { playlist_id: playlistId! } }, init: { signal } }),
    enabled: Boolean(playlistId),
  });
}

function writePlaylistInLists(queryClient: QueryClient, updated: PlaylistPublic) {
  queryClient.setQueryData<PlaylistPublic[]>(queryKeys.playlists.list(), (current) =>
    current ? current.map((p) => (p.id === updated.id ? updated : p)) : current,
  );
}

export interface CreatePlaylistInput {
  name: string;
  description?: string;
  isPublic?: boolean;
}

/** `POST /playlists` — the "Give your playlist a name" -> Create flow (screenshot
 * reference). New playlists always start empty; items are added afterward from
 * the detail screen's own "Add" flow. */
export function useCreatePlaylist() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreatePlaylistInput) =>
      api.post('/playlists', {
        body: { name: input.name, description: input.description ?? null, is_public: input.isPublic ?? true },
      }),
    onSuccess: (playlist) => {
      queryClient.setQueryData<PlaylistPublic[]>(queryKeys.playlists.list(), (current) =>
        current ? [playlist, ...current] : [playlist],
      );
    },
  });
}

export interface UpdatePlaylistInput {
  name?: string;
  description?: string;
  isPublic?: boolean;
}

/** `PATCH /playlists/{id}` — rename, edit description, or toggle public/private
 * (the "Name & details" sheet). Only the fields actually passed are sent, so an
 * omitted field is left untouched server-side — same PATCH convention the
 * profile editor already uses. */
export function useUpdatePlaylist(playlistId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdatePlaylistInput) => {
      const body: Record<string, unknown> = {};
      if (input.name !== undefined) body.name = input.name;
      if (input.description !== undefined) body.description = input.description;
      if (input.isPublic !== undefined) body.is_public = input.isPublic;
      return api.patch('/playlists/{playlist_id}', { params: { path: { playlist_id: playlistId } }, body });
    },
    onSuccess: (playlist) => {
      writePlaylistInLists(queryClient, playlist);
      queryClient.setQueryData<PlaylistDetail>(queryKeys.playlists.detail(playlistId), (current) =>
        current ? { ...current, ...playlist } : current,
      );
    },
  });
}

/** `DELETE /playlists/{id}` — irreversible; the caller's own confirm step (the
 * "Delete playlist" row in Name & details) gates this, not this hook. */
export function useDeletePlaylist() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (playlistId: string) => api.delete('/playlists/{playlist_id}', { params: { path: { playlist_id: playlistId } } }),
    onSuccess: (_data, playlistId) => {
      queryClient.setQueryData<PlaylistPublic[]>(queryKeys.playlists.list(), (current) =>
        current ? current.filter((p) => p.id !== playlistId) : current,
      );
      queryClient.removeQueries({ queryKey: queryKeys.playlists.detail(playlistId) });
    },
  });
}

/** `POST /playlists/{id}/items` — appends a sermon/episode (Spotify allows the
 * same track twice; so does this). Returns the refreshed `PlaylistDetail`
 * directly from the server rather than optimistically patching the cache —
 * the response already carries the recomputed `item_count`/duration/position,
 * so there's nothing to reconcile. */
export function useAddPlaylistItem(playlistId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (sermonId: string) =>
      api.post('/playlists/{playlist_id}/items', {
        params: { path: { playlist_id: playlistId } },
        body: { sermon_id: sermonId },
      }),
    onSuccess: (detail) => {
      queryClient.setQueryData(queryKeys.playlists.detail(playlistId), detail);
      writePlaylistInLists(queryClient, detail);
    },
  });
}

/** `DELETE /playlists/{id}/items/{item_id}` — removes one row by its own item
 * id (not by sermon id — the same sermon may appear more than once). */
export function useRemovePlaylistItem(playlistId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (itemId: string) =>
      api.delete('/playlists/{playlist_id}/items/{item_id}', {
        params: { path: { playlist_id: playlistId, item_id: itemId } },
      }),
    onSuccess: (detail) => {
      queryClient.setQueryData(queryKeys.playlists.detail(playlistId), detail);
      writePlaylistInLists(queryClient, detail);
    },
  });
}

/** `PUT /playlists/{id}/items/order` — all-or-nothing: `itemIds` must be every
 * current item id, just reordered (the server 400s on a partial/mismatched set). */
export function useReorderPlaylistItems(playlistId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (itemIds: string[]) =>
      api.put('/playlists/{playlist_id}/items/order', {
        params: { path: { playlist_id: playlistId } },
        body: { item_ids: itemIds },
      }),
    onSuccess: (detail) => {
      queryClient.setQueryData(queryKeys.playlists.detail(playlistId), detail);
    },
  });
}

/** The hero's "+" button's destination (Isaac's ask, session 2026-10-11: "add sermon to
 * default library") — there's no backend-flagged "default playlist" concept, so this is
 * a client convention: a playlist named exactly this, auto-created the first time it's
 * needed. It's an ordinary playlist after that — visible, editable, deletable in Library
 * like any other — not a hidden special-cased entity. */
export const DEFAULT_LIBRARY_NAME = 'My List';

/** Backs every "My List" toggle's +/checkmark state: whether a sermon is already in
 * `DEFAULT_LIBRARY_NAME`, and the actions that add or remove it, creating that playlist
 * first if this is the very first sermon ever added to it. Looks the playlist up by
 * name from the already-fetched `usePlaylists()` list rather than remembering an id in
 * local storage — one fewer thing that can drift out of sync with the server.
 *
 * `toggleSermon` (Home's hero "+" and sermon detail's own "My List") adds when the
 * sermon isn't in yet, removes when it is — a genuine toggle (Isaac's ask, session
 * 2026-10-11: "allow user toggle"; it only added before, a press once already in did
 * nothing). `toggleSermons` (series detail — Isaac's ask, same session as the original
 * bulk add: every episode at once, the same bulk-operate-on-every-episode convention
 * this screen's own Download pill already established) removes every episode when all
 * are already in, otherwise adds only whichever ones are missing — not a blind re-add
 * of all of them, which would have duplicated the ones already there (this app allows a
 * sermon twice in an ordinary playlist, same as Spotify; "My List" shouldn't exploit
 * that by accident).
 *
 * Both bulk paths resolve/create the playlist exactly once up front, then operate on
 * each sermon in sequence — not `Promise.all`, and not each sermon independently
 * resolving its own playlist id: either of those would let two calls each see "no
 * default playlist yet" and create two, or race each other's cache writes once one
 * exists.
 */
export function useAddToDefaultLibrary() {
  const queryClient = useQueryClient();
  const playlists = usePlaylists();
  const defaultPlaylist = playlists.data?.find((p) => p.name === DEFAULT_LIBRARY_NAME) ?? null;
  const defaultPlaylistDetail = usePlaylist(defaultPlaylist?.id);
  const createPlaylist = useCreatePlaylist();

  const isInDefaultLibrary = (sermonId: string) =>
    defaultPlaylistDetail.data?.items.some((item) => item.sermon.id === sermonId) ?? false;

  const itemIdFor = (sermonId: string): string | undefined =>
    defaultPlaylistDetail.data?.items.find((item) => item.sermon.id === sermonId)?.id;

  const ensureDefaultPlaylistId = async (): Promise<string> =>
    defaultPlaylist?.id ?? (await createPlaylist.mutateAsync({ name: DEFAULT_LIBRARY_NAME })).id;

  const addItem = async (playlistId: string, sermonId: string) => {
    const detail = await api.post('/playlists/{playlist_id}/items', {
      params: { path: { playlist_id: playlistId } },
      body: { sermon_id: sermonId },
    });
    queryClient.setQueryData(queryKeys.playlists.detail(detail.id), detail);
    writePlaylistInLists(queryClient, detail);
    return detail;
  };

  const removeItem = async (playlistId: string, itemId: string) => {
    const detail = await api.delete('/playlists/{playlist_id}/items/{item_id}', {
      params: { path: { playlist_id: playlistId, item_id: itemId } },
    });
    queryClient.setQueryData(queryKeys.playlists.detail(detail.id), detail);
    writePlaylistInLists(queryClient, detail);
    return detail;
  };

  const toggleSermonMutation = useMutation({
    mutationFn: async (sermonId: string) => {
      if (isInDefaultLibrary(sermonId)) {
        // `defaultPlaylist` must already exist to have reached this branch at all.
        return removeItem(defaultPlaylist!.id, itemIdFor(sermonId)!);
      }
      return addItem(await ensureDefaultPlaylistId(), sermonId);
    },
  });

  const toggleSermonsMutation = useMutation({
    mutationFn: async (sermonIds: string[]) => {
      const allIn = sermonIds.length > 0 && sermonIds.every((id) => isInDefaultLibrary(id));
      if (allIn) {
        const playlistId = defaultPlaylist!.id;
        for (const sermonId of sermonIds) {
          await removeItem(playlistId, itemIdFor(sermonId)!);
        }
        return;
      }
      const playlistId = await ensureDefaultPlaylistId();
      for (const sermonId of sermonIds) {
        if (!isInDefaultLibrary(sermonId)) await addItem(playlistId, sermonId);
      }
    },
  });

  return {
    isInDefaultLibrary,
    toggleSermon: toggleSermonMutation.mutate,
    isToggling: toggleSermonMutation.isPending,
    toggleSermons: toggleSermonsMutation.mutate,
    isTogglingAll: toggleSermonsMutation.isPending,
  };
}

export interface PlaylistCoverAsset {
  /** A local `file://`/`content://`/`ph://` URI from `expo-image-picker` — see
   * `useUpdateAvatar`'s own doc comment for why it's fetched into a `Blob`
   * locally rather than uploaded by URI directly; same reasoning applies here. */
  uri: string;
  contentType: string;
  filename: string;
}

/** Cover upload-ticket -> direct-to-storage PUT -> confirm, the same sequence
 * `useUpdateAvatar` uses against `/auth/me/avatar/*`, here against
 * `/playlists/{id}/cover/*` instead. */
export function useUpdatePlaylistCover(playlistId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (asset: PlaylistCoverAsset) => {
      const ticket = await api.post('/playlists/{playlist_id}/cover/upload-ticket', {
        params: { path: { playlist_id: playlistId } },
        body: { filename: asset.filename, content_type: asset.contentType },
      });
      const blob = await (await fetch(asset.uri)).blob();
      const putResponse = await fetch(ticket.upload_url, { method: 'PUT', headers: ticket.headers, body: blob });
      if (!putResponse.ok) throw new Error(`Cover upload failed (${putResponse.status})`);
      return api.post('/playlists/{playlist_id}/cover/confirm', {
        params: { path: { playlist_id: playlistId }, query: { cover_key: ticket.cover_key } },
      });
    },
    onSuccess: ({ cover_url }) => {
      queryClient.setQueryData<PlaylistDetail>(queryKeys.playlists.detail(playlistId), (current) =>
        current ? { ...current, cover_url } : current,
      );
      queryClient.setQueryData<PlaylistPublic[]>(queryKeys.playlists.list(), (current) =>
        current ? current.map((p) => (p.id === playlistId ? { ...p, cover_url } : p)) : current,
      );
    },
  });
}
