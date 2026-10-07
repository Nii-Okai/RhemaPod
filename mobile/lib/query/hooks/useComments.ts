import { useInfiniteQuery, useMutation, useQueryClient, type InfiniteData, type QueryClient } from '@tanstack/react-query';
import { api } from '../../api/typedClient';
import { queryKeys } from '../queryClient';
import type { components } from '../../api/schema';

export type CommentPublic = components['schemas']['CommentPublic'];
export type CommentReportReason = components['schemas']['CommentReportReason'];
type CommentsPage = components['schemas']['Page_CommentPublic_'];
type CommentsData = InfiniteData<CommentsPage, number>;

export const COMMENTS_PAGE_SIZE = 25;

/**
 * Per-session (never persisted) ids the viewer has reported this app launch. `GET
 * /sermons/{sermon_id}/comments` does not exclude a reporter's own reported rows
 * server-side (left to a follow-up decision), so a reported comment would otherwise
 * reappear on the very next refetch — a block/unblock/name-edit/delete settle
 * invalidation, pull-to-refresh, or simply reopening the screen. `useSermonComments`
 * filters these out of every page via `select`, so the hide holds for the rest of the
 * session; it resets on app relaunch, which is fine since the report is still recorded
 * server-side regardless.
 */
const reportedCommentIds = new Set<string>();

/** Test-only: clears the per-session reported-id set so test cases don't leak into each other. */
export function __resetReportedCommentIdsForTests() {
  reportedCommentIds.clear();
}

/**
 * `GET /sermons/{sermon_id}/comments` — newest first (the only order the contract has: no
 * likes, no Top). Offset-paginated. Rows the caller must not see (other people's HIDDEN
 * comments, blocked authors) are already excluded server-side, `total` included. The
 * cached pages themselves are left exactly as the server returned them (`offset`/`total`
 * untouched, so pagination math in `getNextPageParam` stays correct) — rows the viewer
 * has reported this session are filtered out at display time, in `flattenComments`, not
 * here (see `reportedCommentIds` above).
 */
export function useSermonComments(sermonId: string, options: { enabled?: boolean } = {}) {
  return useInfiniteQuery({
    queryKey: queryKeys.comments.forSermon(sermonId),
    initialPageParam: 0,
    queryFn: ({ pageParam, signal }) =>
      api.get('/sermons/{sermon_id}/comments', {
        params: { path: { sermon_id: sermonId }, query: { limit: COMMENTS_PAGE_SIZE, offset: pageParam } },
        init: { signal },
      }),
    getNextPageParam: (lastPage) => {
      const next = lastPage.offset + lastPage.items.length;
      return lastPage.items.length > 0 && next < lastPage.total ? next : undefined;
    },
    enabled: options.enabled ?? true,
  });
}

/**
 * Flattens the loaded pages into one list. Offset pagination over a live, newest-first
 * thread can repeat a row (a post landing between two page fetches shifts every offset),
 * so rows are de-duplicated by id, first occurrence winning. Rows the viewer has reported
 * this session are also dropped here (see `reportedCommentIds` above) — the server does
 * not exclude a reporter's own reported rows, so a settle-time invalidation, pull-to-
 * refresh, or reopening the screen can return one; this is the one place every consumer
 * reads the cache through, so it's the one place that needs to re-apply the hide.
 */
export function flattenComments(data: InfiniteData<CommentsPage, unknown> | undefined): { items: CommentPublic[]; total: number } {
  if (!data || data.pages.length === 0) return { items: [], total: 0 };
  const seen = new Set<string>();
  const items: CommentPublic[] = [];
  let hiddenCount = 0;
  for (const page of data.pages) {
    for (const item of page.items) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      if (reportedCommentIds.has(item.id)) {
        hiddenCount += 1;
        continue;
      }
      items.push(item);
    }
  }
  const total = data.pages[data.pages.length - 1]!.total;
  return { items, total: Math.max(0, total - hiddenCount) };
}

/** Rewrites every cached page through `keep`, adjusting `total` by the number of rows dropped. */
function removeRows(data: CommentsData | undefined, drop: (item: CommentPublic) => boolean): CommentsData | undefined {
  if (!data) return data;
  const dropped = new Set<string>();
  for (const page of data.pages) for (const item of page.items) if (drop(item)) dropped.add(item.id);
  if (dropped.size === 0) return data;
  return {
    ...data,
    pages: data.pages.map((page) => ({
      ...page,
      items: page.items.filter((item) => !dropped.has(item.id)),
      total: Math.max(0, page.total - dropped.size),
    })),
  };
}

function prependRow(data: CommentsData | undefined, row: CommentPublic): CommentsData | undefined {
  if (!data) return data;
  if (data.pages.length === 0) {
    // A cache entry can exist with zero pages (e.g. seeded before any fetch resolved).
    // Build the first page from scratch so the new row shows immediately rather than
    // waiting for the next refetch.
    const firstPage: CommentsPage = { items: [row], limit: COMMENTS_PAGE_SIZE, offset: 0, total: 1 };
    return { ...data, pages: [firstPage], pageParams: [0] };
  }
  const [first, ...rest] = data.pages;
  return {
    ...data,
    pages: [
      { ...first!, items: [row, ...first!.items.filter((item) => item.id !== row.id)] },
      ...rest,
    ].map((page) => ({ ...page, total: page.total + 1 })),
  };
}

async function snapshot(queryClient: QueryClient, sermonId: string) {
  const key = queryKeys.comments.forSermon(sermonId);
  await queryClient.cancelQueries({ queryKey: key });
  return { key, previous: queryClient.getQueryData<CommentsData>(key) };
}

/**
 * `POST /sermons/{sermon_id}/comments`. Deliberately NOT optimistic: the server may refuse
 * (name/terms/entitlement 403, a 422 content rule, a 429), and the row's id, display name
 * and timestamp are the server's. On success the returned row is prepended to the first
 * page. If nothing is cached yet the list is refetched instead.
 */
export function usePostComment(sermonId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: string) =>
      api.post('/sermons/{sermon_id}/comments', { params: { path: { sermon_id: sermonId } }, body: { body } }),
    onSuccess: (row) => {
      const key = queryKeys.comments.forSermon(sermonId);
      if (queryClient.getQueryData(key)) {
        queryClient.setQueryData<CommentsData>(key, (data) => prependRow(data, row));
      } else {
        void queryClient.invalidateQueries({ queryKey: key });
      }
    },
  });
}

/**
 * `DELETE /comments/{comment_id}` — optimistic removal, restored if the request fails (a
 * 409 while the comment is HIDDEN, a 404, or the network). The list refetches afterwards
 * so offsets re-align with the server.
 */
export function useDeleteComment(sermonId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (commentId: string) =>
      api.delete('/comments/{comment_id}', { params: { path: { comment_id: commentId } } }),
    onMutate: async (commentId) => {
      const { key, previous } = await snapshot(queryClient, sermonId);
      queryClient.setQueryData<CommentsData>(key, (data) => removeRows(data, (item) => item.id === commentId));
      return { key, previous };
    },
    onError: (_err, _id, context) => {
      if (context?.previous) queryClient.setQueryData(context.key, context.previous);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.comments.forSermon(sermonId) });
    },
  });
}

export interface ReportCommentVars {
  commentId: string;
  reason: CommentReportReason;
  detail?: string;
}

/**
 * `POST /comments/{comment_id}/report`. Once the server accepts it the row is hidden
 * locally for the reporter (the server keeps showing nothing special; the reporter simply
 * stops seeing it). A duplicate or own-comment report is a 204 as well, so it hides the
 * same way with no special UI.
 */
export function useReportComment(sermonId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ commentId, reason, detail }: ReportCommentVars) =>
      api.post('/comments/{comment_id}/report', {
        params: { path: { comment_id: commentId } },
        body: detail ? { reason, detail } : { reason },
      }),
    onSuccess: (_data, { commentId }) => {
      reportedCommentIds.add(commentId);
      queryClient.setQueryData<CommentsData>(queryKeys.comments.forSermon(sermonId), (data) =>
        removeRows(data, (item) => item.id === commentId),
      );
    },
  });
}

export interface BlockAuthorVars {
  commentId: string;
  /** The author's public name on the row. The DTO has no user id, so this is the match key. */
  authorDisplayName: string;
}

/**
 * `POST /comments/{comment_id}/block` — optimistic: every cached row by that author
 * disappears at once, restored on failure. The response `id` is the block row id the
 * caller's Undo passes to `useUnblock` (`null` when there was nothing to block). Matching
 * is by display name because the DTO carries no user id, so two people sharing "Nii O."
 * both vanish until the settle-time refetch brings the unblocked one back.
 */
export function useBlockAuthor(sermonId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ commentId }: BlockAuthorVars) =>
      api.post('/comments/{comment_id}/block', { params: { path: { comment_id: commentId } } }),
    onMutate: async ({ authorDisplayName }) => {
      const { key, previous } = await snapshot(queryClient, sermonId);
      queryClient.setQueryData<CommentsData>(key, (data) =>
        removeRows(data, (item) => !item.is_mine && item.author_display_name === authorDisplayName),
      );
      return { key, previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(context.key, context.previous);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.comments.forSermon(sermonId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.me.blocks() });
    },
  });
}
