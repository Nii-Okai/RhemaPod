import { renderHook, waitFor } from '@testing-library/react-native';
import { api } from '../../../api/typedClient';
import { ApiError } from '../../../api/errors';
import { useSermonDetail, useSermons } from '../useSermons';
import { wrapWithQueryClient } from '../../testUtils';

jest.mock('../../../api/typedClient', () => ({
  api: { get: jest.fn() },
}));

const mockedGet = api.get as jest.Mock;

beforeEach(() => {
  mockedGet.mockReset();
});

describe('useSermons', () => {
  it('resolves with the sermon list the fetch boundary returns', async () => {
    const sermons = [{ id: 's1', title: 'Anchored in the Storm' }];
    mockedGet.mockResolvedValue(sermons);

    const { result } = renderHook(() => useSermons(), { wrapper: wrapWithQueryClient() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(sermons);
    expect(mockedGet).toHaveBeenCalledWith('/catalog/sermons', expect.objectContaining({ init: expect.anything() }));
  });

  it('surfaces a fetch-boundary failure as an error state', async () => {
    mockedGet.mockRejectedValue(new ApiError(500, 'Something went wrong. Try again.'));

    const { result } = renderHook(() => useSermons(), { wrapper: wrapWithQueryClient() });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(ApiError);
  });
});

describe('useSermonDetail', () => {
  it('calls the catalog detail path with the sermon id', async () => {
    const detail = { id: 's1', title: 'Anchored in the Storm' };
    mockedGet.mockResolvedValue(detail);

    const { result } = renderHook(() => useSermonDetail('s1'), { wrapper: wrapWithQueryClient() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(detail);
    expect(mockedGet).toHaveBeenCalledWith(
      '/catalog/sermons/{sermon_id}',
      expect.objectContaining({ params: { path: { sermon_id: 's1' } } }),
    );
  });
});
