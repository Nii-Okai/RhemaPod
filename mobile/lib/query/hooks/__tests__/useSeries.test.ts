import { renderHook, waitFor } from '@testing-library/react-native';
import { api } from '../../../api/typedClient';
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
