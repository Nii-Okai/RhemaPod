import { renderHook, waitFor } from '@testing-library/react-native';
import { api } from '../../../api/typedClient';
import { ApiError } from '../../../api/errors';
import { useSeriesDetail, useSeriesEpisodes, useSeriesList } from '../useSeries';
import { wrapWithQueryClient } from '../../testUtils';

jest.mock('../../../api/typedClient', () => ({
  api: { get: jest.fn() },
}));

const mockedGet = api.get as jest.Mock;

beforeEach(() => {
  mockedGet.mockReset();
});

describe('useSeriesList', () => {
  it('calls GET /series', async () => {
    mockedGet.mockResolvedValue([]);
    const { result } = renderHook(() => useSeriesList(), { wrapper: wrapWithQueryClient() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedGet).toHaveBeenCalledWith('/series', expect.objectContaining({ init: expect.anything() }));
  });

  it('resolves with the series list the fetch boundary returns', async () => {
    const series = [{ id: 'se1', title: 'Storms', episode_count: 4 }];
    mockedGet.mockResolvedValue(series);

    const { result } = renderHook(() => useSeriesList(), { wrapper: wrapWithQueryClient() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(series);
  });

  it('surfaces a fetch-boundary failure as an error state', async () => {
    mockedGet.mockRejectedValue(new ApiError(500, 'Something went wrong. Try again.'));

    const { result } = renderHook(() => useSeriesList(), { wrapper: wrapWithQueryClient() });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(ApiError);
  });
});

describe('useSeriesDetail', () => {
  it('calls GET /series/{series_id} with the given id', async () => {
    mockedGet.mockResolvedValue({ id: 's1', title: 'Anchored' });
    const { result } = renderHook(() => useSeriesDetail('s1'), { wrapper: wrapWithQueryClient() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedGet).toHaveBeenCalledWith(
      '/series/{series_id}',
      expect.objectContaining({ params: { path: { series_id: 's1' } } }),
    );
  });
});

describe('useSeriesEpisodes', () => {
  it('calls GET /series/{series_id}/episodes with the given id', async () => {
    mockedGet.mockResolvedValue([]);
    const { result } = renderHook(() => useSeriesEpisodes('s1'), { wrapper: wrapWithQueryClient() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedGet).toHaveBeenCalledWith(
      '/series/{series_id}/episodes',
      expect.objectContaining({ params: { path: { series_id: 's1' } } }),
    );
  });
});
