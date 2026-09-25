import { renderHook, waitFor } from '@testing-library/react-native';
import { api } from '../../../api/typedClient';
import { ApiError } from '../../../api/errors';
import { useSeries } from '../useSeries';
import { wrapWithQueryClient } from '../../testUtils';

jest.mock('../../../api/typedClient', () => ({
  api: { get: jest.fn() },
}));

const mockedGet = api.get as jest.Mock;

beforeEach(() => {
  mockedGet.mockReset();
});

describe('useSeries', () => {
  it('resolves with the series list the fetch boundary returns', async () => {
    const series = [{ id: 'se1', title: 'Storms', episode_count: 4 }];
    mockedGet.mockResolvedValue(series);

    const { result } = renderHook(() => useSeries(), { wrapper: wrapWithQueryClient() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(series);
    expect(mockedGet).toHaveBeenCalledWith('/series', expect.objectContaining({ init: expect.anything() }));
  });

  it('surfaces a fetch-boundary failure as an error state', async () => {
    mockedGet.mockRejectedValue(new ApiError(500, 'Something went wrong. Try again.'));

    const { result } = renderHook(() => useSeries(), { wrapper: wrapWithQueryClient() });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(ApiError);
  });
});
