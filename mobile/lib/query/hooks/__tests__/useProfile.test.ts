import { renderHook, waitFor } from '@testing-library/react-native';
import { api } from '../../../api/typedClient';
import { useCurrentUser } from '../useProfile';
import { wrapWithQueryClient } from '../../testUtils';

jest.mock('../../../api/typedClient', () => ({
  api: { get: jest.fn() },
}));

const mockedGet = api.get as jest.Mock;

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
