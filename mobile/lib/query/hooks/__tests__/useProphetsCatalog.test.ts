import { renderHook, waitFor } from '@testing-library/react-native';
import { api } from '../../../api/typedClient';
import { useProphetsCatalog } from '../useProphetsCatalog';
import { wrapWithQueryClient } from '../../testUtils';

jest.mock('../../../api/typedClient', () => ({
  api: { get: jest.fn() },
}));

const mockedGet = api.get as jest.Mock;

beforeEach(() => {
  mockedGet.mockReset();
});

describe('useProphetsCatalog', () => {
  it('resolves with the prophets-catalog sermons the fetch boundary returns', async () => {
    const items = [{ id: 's1', title: 'A Word for the Season' }];
    mockedGet.mockResolvedValue(items);

    const { result } = renderHook(() => useProphetsCatalog(), { wrapper: wrapWithQueryClient() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(items);
    expect(mockedGet).toHaveBeenCalledWith(
      '/catalog/sermons/prophets-catalog',
      expect.objectContaining({ init: expect.anything() }),
    );
  });

  it('resolves with an empty array when nothing is flagged yet', async () => {
    mockedGet.mockResolvedValue([]);

    const { result } = renderHook(() => useProphetsCatalog(), { wrapper: wrapWithQueryClient() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });
});
