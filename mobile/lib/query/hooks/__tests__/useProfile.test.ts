import { act, renderHook, waitFor } from '@testing-library/react-native';
import { api } from '../../../api/typedClient';
import { ApiError } from '../../../api/errors';
import { useAcceptCommentsTerms, useCurrentUser, useUpdateFullName } from '../useProfile';
import { queryKeys } from '../../queryClient';
import { createTestQueryClient, wrapWithQueryClient } from '../../testUtils';

jest.mock('../../../api/typedClient', () => ({
  api: { get: jest.fn(), patch: jest.fn(), post: jest.fn() },
}));

const mockedGet = api.get as jest.Mock;
const mockedPatch = api.patch as jest.Mock;
const mockedPost = api.post as jest.Mock;

const user = {
  id: 'user-1',
  email: 'ada@example.com',
  full_name: 'Ada Nwosu',
  role: 'member',
  is_active: true,
  created_at: '2024-01-01T00:00:00Z',
  activated_at: '2024-01-02T00:00:00Z',
};

beforeEach(() => {
  mockedGet.mockReset();
  mockedPatch.mockReset();
  mockedPost.mockReset();
});

describe('useCurrentUser', () => {
  it('calls GET /auth/me and returns the caller\'s own profile', async () => {
    mockedGet.mockResolvedValue(user);
    const { result } = renderHook(() => useCurrentUser(), { wrapper: wrapWithQueryClient() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedGet).toHaveBeenCalledWith('/auth/me', expect.objectContaining({}));
    expect(result.current.data).toEqual(user);
  });

  it('surfaces a fetch failure as an error state, not a thrown exception', async () => {
    mockedGet.mockRejectedValue(new Error('network down'));
    const { result } = renderHook(() => useCurrentUser(), { wrapper: wrapWithQueryClient() });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe('useUpdateFullName', () => {
  it('PATCHes /auth/me with the new name and writes the returned profile into the cache', async () => {
    const client = createTestQueryClient();
    mockedGet.mockResolvedValue(user);
    renderHook(() => useCurrentUser(), { wrapper: wrapWithQueryClient(client) }); // observer keeps the cache entry alive (test gcTime is 0)
    await waitFor(() => expect(client.getQueryData(queryKeys.me.profile())).toEqual(user));
    const updated = { ...user, full_name: 'Ada Obi' };
    mockedPatch.mockResolvedValue(updated);
    mockedGet.mockResolvedValue(updated);

    const { result } = renderHook(() => useUpdateFullName(), { wrapper: wrapWithQueryClient(client) });
    await act(async () => {
      await result.current.mutateAsync('Ada Obi');
    });

    expect(mockedPatch).toHaveBeenCalledWith('/auth/me', { body: { full_name: 'Ada Obi' } });
    expect(client.getQueryData(queryKeys.me.profile())).toEqual(updated);
  });

  it('surfaces the server rejection (generic 422) and leaves the cached profile alone', async () => {
    const client = createTestQueryClient();
    mockedGet.mockResolvedValue(user);
    renderHook(() => useCurrentUser(), { wrapper: wrapWithQueryClient(client) });
    await waitFor(() => expect(client.getQueryData(queryKeys.me.profile())).toEqual(user));
    mockedPatch.mockRejectedValue(new ApiError(422, "This name can't be used"));

    const { result } = renderHook(() => useUpdateFullName(), { wrapper: wrapWithQueryClient(client) });
    await act(async () => {
      await result.current.mutateAsync('Dr Bad').catch(() => {});
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as ApiError).status).toBe(422);
    expect(client.getQueryData(queryKeys.me.profile())).toEqual(user);
  });
});

describe('useAcceptCommentsTerms', () => {
  it('POSTs /me/comments-terms and stamps the cached profile so the gate passes at once', async () => {
    const client = createTestQueryClient();
    mockedGet.mockResolvedValue({ ...user, comments_terms_accepted_at: null });
    renderHook(() => useCurrentUser(), { wrapper: wrapWithQueryClient(client) });
    await waitFor(() => expect(client.getQueryData(queryKeys.me.profile())).toBeDefined());
    mockedPost.mockResolvedValue(undefined);
    mockedGet.mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => useAcceptCommentsTerms(), { wrapper: wrapWithQueryClient(client) });
    await act(async () => {
      await result.current.mutateAsync();
    });

    expect(mockedPost).toHaveBeenCalledWith('/me/comments-terms');
    const cached = client.getQueryData(queryKeys.me.profile()) as { comments_terms_accepted_at: string | null };
    expect(cached.comments_terms_accepted_at).toEqual(expect.any(String));
  });
});
