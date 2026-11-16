import { renderHook, waitFor } from '@testing-library/react-native';
import { api } from '../../../api/typedClient';
import { useTrending } from '../useTrending';
import { wrapWithQueryClient } from '../../testUtils';

jest.mock('../../../api/typedClient', () => ({
  api: { get: jest.fn() },
}));

const mockedGet = api.get as jest.Mock;

beforeEach(() => {
  mockedGet.mockReset();
});

describe('useTrending', () => {
  it('resolves with the trending sermons the fetch boundary returns', async () => {
    const items = [{ id: 's1', title: 'Popular Sermon' }];
    mockedGet.mockResolvedValue(items);

    const { result } = renderHook(() => useTrending(), { wrapper: wrapWithQueryClient() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(items);
    expect(mockedGet).toHaveBeenCalledWith(
      '/catalog/sermons/trending',
      expect.objectContaining({ init: expect.anything() }),
    );
  });

  it('resolves with an empty array when nothing is trending', async () => {
    mockedGet.mockResolvedValue([]);

    const { result } = renderHook(() => useTrending(), { wrapper: wrapWithQueryClient() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });
});
