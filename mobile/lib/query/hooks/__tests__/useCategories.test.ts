import { renderHook, waitFor } from '@testing-library/react-native';
import { api } from '../../../api/typedClient';
import { ApiError } from '../../../api/errors';
import { useCategories } from '../useCategories';
import { wrapWithQueryClient } from '../../testUtils';

jest.mock('../../../api/typedClient', () => ({
  api: { get: jest.fn() },
}));

const mockedGet = api.get as jest.Mock;

beforeEach(() => {
  mockedGet.mockReset();
});

describe('useCategories', () => {
  it('resolves with the categories the fetch boundary returns', async () => {
    const categories = [
      { id: 'c1', name: 'Teaching', slug: 'teaching', sermon_count: 54 },
      { id: 'c2', name: 'Worship', slug: 'worship', sermon_count: 22 },
    ];
    mockedGet.mockResolvedValue(categories);

    const { result } = renderHook(() => useCategories(), { wrapper: wrapWithQueryClient() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(categories);
    expect(mockedGet).toHaveBeenCalledWith('/categories', expect.objectContaining({ init: expect.anything() }));
  });

  it('surfaces a fetch-boundary failure as an error state, not a thrown exception', async () => {
    mockedGet.mockRejectedValue(new ApiError(500, 'Something went wrong. Try again.'));

    const { result } = renderHook(() => useCategories(), { wrapper: wrapWithQueryClient() });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(ApiError);
  });
});
