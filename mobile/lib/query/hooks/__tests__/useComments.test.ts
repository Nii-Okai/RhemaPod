import { act, renderHook, waitFor } from '@testing-library/react-native';
import { api } from '../../../api/typedClient';
import { ApiError } from '../../../api/errors';
import { queryKeys } from '../../queryClient';
import { createTestQueryClient, wrapWithQueryClient } from '../../testUtils';
import {
  COMMENTS_PAGE_SIZE,
  __resetReportedCommentIdsForTests,
  flattenComments,
  useBlockAuthor,
  useDeleteComment,
  usePostComment,
  useReportComment,
  useSermonComments,
  type CommentPublic,
} from '../useComments';

jest.mock('../../../api/typedClient', () => ({
  api: { get: jest.fn(), post: jest.fn(), delete: jest.fn() },
}));

const mockedGet = api.get as jest.Mock;
const mockedPost = api.post as jest.Mock;
const mockedDelete = api.delete as jest.Mock;

function comment(id: string, overrides: Partial<CommentPublic> = {}): CommentPublic {
  return {
    id,
    sermon_id: 's1',
    author_display_name: `Author ${id}`,
    body: `body ${id}`,
    created_at: '2026-10-01T00:00:00Z',
    is_mine: false,
    status: 'VISIBLE',
    hidden_label: null,
    ...overrides,
  };
}

const page = (items: CommentPublic[], total: number, offset = 0) => ({ items, total, limit: COMMENTS_PAGE_SIZE, offset });

const ids = (client: ReturnType<typeof createTestQueryClient>) =>
  flattenComments(client.getQueryData(queryKeys.comments.forSermon('s1'))).items.map((c) => c.id);

beforeEach(() => {
  mockedGet.mockReset();
  mockedPost.mockReset();
  mockedDelete.mockReset();
  __resetReportedCommentIdsForTests();
});

async function loaded(client = createTestQueryClient()) {
  mockedGet.mockResolvedValue(
    page([comment('a'), comment('b', { author_display_name: 'Pat Q.' }), comment('c', { author_display_name: 'Pat Q.' })], 3),
  );
  const hook = renderHook(() => useSermonComments('s1'), { wrapper: wrapWithQueryClient(client) });
  await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
  return { client, hook };
}

describe('useSermonComments', () => {
  it('reads newest-first pages by offset and stops when everything is loaded', async () => {
    const { hook } = await loaded();
    expect(mockedGet).toHaveBeenCalledWith(
      '/sermons/{sermon_id}/comments',
      expect.objectContaining({ params: { path: { sermon_id: 's1' }, query: { limit: COMMENTS_PAGE_SIZE, offset: 0 } } }),
    );
    expect(hook.result.current.hasNextPage).toBe(false);
  });

  it('requests the next offset while more remain', async () => {
    mockedGet.mockResolvedValueOnce(page([comment('a'), comment('b')], 3));
    const { result } = renderHook(() => useSermonComments('s1'), { wrapper: wrapWithQueryClient() });
    await waitFor(() => expect(result.current.hasNextPage).toBe(true));

    mockedGet.mockResolvedValueOnce(page([comment('c')], 3, 2));
    await act(async () => {
      await result.current.fetchNextPage();
    });
    expect(mockedGet).toHaveBeenLastCalledWith(
      '/sermons/{sermon_id}/comments',
      expect.objectContaining({
        params: expect.objectContaining({ query: { limit: COMMENTS_PAGE_SIZE, offset: 2 } }),
      }),
    );
    await waitFor(() => expect(flattenComments(result.current.data).items.map((c) => c.id)).toEqual(['a', 'b', 'c']));
  });

  it('does not fetch while disabled (offline)', () => {
    renderHook(() => useSermonComments('s1', { enabled: false }), { wrapper: wrapWithQueryClient() });
    expect(mockedGet).not.toHaveBeenCalled();
  });
});

describe('flattenComments', () => {
  it('de-duplicates rows repeated across pages by id', () => {
    const data = {
      pages: [page([comment('a'), comment('b')], 3), page([comment('b'), comment('c')], 3, 2)],
      pageParams: [0, 2],
    };
    expect(flattenComments(data).items.map((c) => c.id)).toEqual(['a', 'b', 'c']);
    expect(flattenComments(undefined)).toEqual({ items: [], total: 0 });
  });
});

describe('usePostComment', () => {
  it('is not optimistic: nothing is added until the server returns the row, which is then prepended', async () => {
    const { client } = await loaded();
    let resolvePost: (row: CommentPublic) => void = () => {};
    mockedPost.mockReturnValue(new Promise<CommentPublic>((resolve) => (resolvePost = resolve)));

    const { result } = renderHook(() => usePostComment('s1'), { wrapper: wrapWithQueryClient(client) });
    act(() => result.current.mutate('hello'));
    await waitFor(() => expect(result.current.isPending).toBe(true));
    expect(ids(client)).toEqual(['a', 'b', 'c']);

    await act(async () => resolvePost(comment('new', { is_mine: true, body: 'hello' })));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(ids(client)).toEqual(['new', 'a', 'b', 'c']);
    expect(flattenComments(client.getQueryData(queryKeys.comments.forSermon('s1'))).total).toBe(4);
    expect(mockedPost).toHaveBeenCalledWith('/sermons/{sermon_id}/comments', {
      params: { path: { sermon_id: 's1' } },
      body: { body: 'hello' },
    });
  });

  it('adds nothing when the server refuses (422)', async () => {
    const { client } = await loaded();
    mockedPost.mockRejectedValue(new ApiError(422, 'Links are not allowed.'));
    const { result } = renderHook(() => usePostComment('s1'), { wrapper: wrapWithQueryClient(client) });
    await act(async () => {
      await result.current.mutateAsync('http://x.com').catch(() => {});
    });
    expect(ids(client)).toEqual(['a', 'b', 'c']);
  });

  it('shows the new row immediately even when the cache was seeded with zero pages', async () => {
    const client = createTestQueryClient();
    const key = queryKeys.comments.forSermon('s1');
    // A cache entry can exist with `pages: []` (seeded before any fetch resolved) — in
    // real usage that only happens while a `useSermonComments` observer is mounted and
    // still in flight, so an observer is kept alive here too (an unobserved `gcTime: 0`
    // entry would otherwise be garbage-collected before `onSuccess` ever reads it, which
    // isn't the scenario this test means to cover). `mockedGet` never resolves, matching
    // "seeded before any fetch resolved".
    mockedGet.mockReturnValue(new Promise(() => {}));
    const observer = renderHook(() => useSermonComments('s1'), { wrapper: wrapWithQueryClient(client) });
    client.setQueryData(key, { pages: [], pageParams: [] });
    mockedPost.mockResolvedValue(comment('new', { is_mine: true, body: 'hello' }));
    const { result } = renderHook(() => usePostComment('s1'), { wrapper: wrapWithQueryClient(client) });

    await act(async () => {
      await result.current.mutateAsync('hello');
    });

    expect(ids(client)).toEqual(['new']);
    expect(flattenComments(client.getQueryData(key)).total).toBe(1);
    observer.unmount();
  });
});

describe('useDeleteComment', () => {
  it('removes the row optimistically and restores it when the server refuses (409 while hidden)', async () => {
    const { client } = await loaded();
    let rejectDelete: (e: unknown) => void = () => {};
    mockedDelete.mockReturnValue(new Promise((_, reject) => (rejectDelete = reject)));

    const { result } = renderHook(() => useDeleteComment('s1'), { wrapper: wrapWithQueryClient(client) });
    act(() => result.current.mutate('a'));
    await waitFor(() => expect(ids(client)).toEqual(['b', 'c']));

    await act(async () => rejectDelete(new ApiError(409, 'Conflict')));
    await waitFor(() => expect(result.current.isError).toBe(true));
    await waitFor(() => expect(ids(client)).toEqual(['a', 'b', 'c']));
  });
});

describe('useReportComment', () => {
  it('hides the row locally once the report is accepted and sends reason + detail', async () => {
    const { client } = await loaded();
    mockedPost.mockResolvedValue(undefined);
    const { result } = renderHook(() => useReportComment('s1'), { wrapper: wrapWithQueryClient(client) });
    await act(async () => {
      await result.current.mutateAsync({ commentId: 'b', reason: 'other', detail: 'why' });
    });
    expect(mockedPost).toHaveBeenCalledWith('/comments/{comment_id}/report', {
      params: { path: { comment_id: 'b' } },
      body: { reason: 'other', detail: 'why' },
    });
    expect(ids(client)).toEqual(['a', 'c']);
  });

  it('keeps the row and surfaces the error on failure (429)', async () => {
    const { client } = await loaded();
    mockedPost.mockRejectedValue(new ApiError(429, 'slow down'));
    const { result } = renderHook(() => useReportComment('s1'), { wrapper: wrapWithQueryClient(client) });
    await act(async () => {
      await result.current.mutateAsync({ commentId: 'b', reason: 'spam' }).catch(() => {});
    });
    expect(ids(client)).toEqual(['a', 'b', 'c']);
  });

  it('keeps a reported row hidden across a refetch, since the server does not exclude it', async () => {
    const { client, hook } = await loaded();
    mockedPost.mockResolvedValue(undefined);
    const report = renderHook(() => useReportComment('s1'), { wrapper: wrapWithQueryClient(client) });
    await act(async () => {
      await report.result.current.mutateAsync({ commentId: 'b', reason: 'spam' });
    });
    // Read the raw cache (not `hook.result.current.data`) for this first check, same as
    // the other useReportComment tests above — `report`'s onSuccess writes the raw cache
    // directly via setQueryData, which this confirms without depending on `hook` (a
    // separate renderHook instance) having re-rendered yet.
    expect(ids(client)).toEqual(['a', 'c']);

    // GET /sermons/{id}/comments does not exclude the reporter's own reported rows
    // server-side, so a settle-time invalidation, pull-to-refresh, or reopening the screen
    // can return 'b' again. It must stay hidden locally for the rest of the session.
    mockedGet.mockResolvedValue(
      page(
        [comment('a'), comment('b', { author_display_name: 'Pat Q.' }), comment('c', { author_display_name: 'Pat Q.' })],
        3,
      ),
    );
    await act(async () => {
      await hook.result.current.refetch();
    });

    await waitFor(() =>
      expect(flattenComments(hook.result.current.data).items.map((c) => c.id)).toEqual(['a', 'c']),
    );
    expect(flattenComments(hook.result.current.data).total).toBe(2);
  });
});

describe('useBlockAuthor', () => {
  it('optimistically removes every row by that author and returns the block id', async () => {
    const { client } = await loaded();
    mockedPost.mockResolvedValueOnce({ id: 'block-9' });
    // The settle-time refetch returns what the server now serves.
    mockedGet.mockResolvedValue(page([comment('a')], 1));
    const { result } = renderHook(() => useBlockAuthor('s1'), { wrapper: wrapWithQueryClient(client) });

    let data: { id?: string | null } | undefined;
    await act(async () => {
      data = await result.current.mutateAsync({ commentId: 'b', authorDisplayName: 'Pat Q.' });
    });
    expect(data).toEqual({ id: 'block-9' });
    expect(mockedPost).toHaveBeenCalledWith('/comments/{comment_id}/block', { params: { path: { comment_id: 'b' } } });
    await waitFor(() => expect(ids(client)).toEqual(['a']));
  });

  it('restores the removed rows when the block fails', async () => {
    const { client } = await loaded();
    let rejectBlock: (e: unknown) => void = () => {};
    mockedPost.mockReturnValue(new Promise((_, reject) => (rejectBlock = reject)));
    const { result } = renderHook(() => useBlockAuthor('s1'), { wrapper: wrapWithQueryClient(client) });

    act(() => result.current.mutate({ commentId: 'b', authorDisplayName: 'Pat Q.' }));
    await waitFor(() => expect(ids(client)).toEqual(['a']));

    await act(async () => rejectBlock(new ApiError(500, 'boom')));
    await waitFor(() => expect(result.current.isError).toBe(true));
    await waitFor(() => expect(ids(client)).toEqual(['a', 'b', 'c']));
  });
});
