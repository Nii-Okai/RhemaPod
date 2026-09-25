import { renderHook, waitFor } from '@testing-library/react-native';
import { api } from '../../../api/typedClient';
import { useContinueWatching } from '../useContinueWatching';
import { wrapWithQueryClient } from '../../testUtils';

jest.mock('../../../api/typedClient', () => ({
  api: { get: jest.fn() },
}));

const mockedGet = api.get as jest.Mock;

beforeEach(() => {
  mockedGet.mockReset();
});

describe('useContinueWatching', () => {
  it('resolves with the in-progress sermons the fetch boundary returns', async () => {
    const items = [{ id: 's1', title: 'Anchored in the Storm', position_seconds: 120 }];
    mockedGet.mockResolvedValue(items);

    const { result } = renderHook(() => useContinueWatching(), { wrapper: wrapWithQueryClient() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(items);
    expect(mockedGet).toHaveBeenCalledWith(
      '/me/continue-watching',
      expect.objectContaining({ init: expect.anything() }),
    );
  });

  it('resolves with an empty array when nothing is in progress', async () => {
    mockedGet.mockResolvedValue([]);

    const { result } = renderHook(() => useContinueWatching(), { wrapper: wrapWithQueryClient() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });
});
