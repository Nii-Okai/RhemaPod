import { renderHook, waitFor } from '@testing-library/react-native';
import { api } from '../../../api/typedClient';
import { useWatchHistory, WATCH_HISTORY_LIMIT } from '../useWatchHistory';
import { wrapWithQueryClient } from '../../testUtils';

jest.mock('../../../api/typedClient', () => ({
  api: { get: jest.fn() },
}));

const mockedGet = api.get as jest.Mock;

beforeEach(() => {
  mockedGet.mockReset();
});

describe('useWatchHistory', () => {
  it('calls GET /me/history at the backend ceiling, one call not a fan-out', async () => {
    mockedGet.mockResolvedValue([]);
    const { result } = renderHook(() => useWatchHistory(), { wrapper: wrapWithQueryClient() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedGet).toHaveBeenCalledTimes(1);
    expect(mockedGet).toHaveBeenCalledWith(
      '/me/history',
      expect.objectContaining({ params: { query: { limit: WATCH_HISTORY_LIMIT } } }),
    );
  });

  it('Decision 6: calls GET /me/history scoped to series_id, not the app-wide limit, when a seriesId is given', async () => {
    mockedGet.mockResolvedValue([]);
    const { result } = renderHook(() => useWatchHistory('series-1'), { wrapper: wrapWithQueryClient() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedGet).toHaveBeenCalledTimes(1);
    expect(mockedGet).toHaveBeenCalledWith(
      '/me/history',
      expect.objectContaining({ params: { query: { series_id: 'series-1' } } }),
    );
  });
});
