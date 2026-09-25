import { renderHook, waitFor } from '@testing-library/react-native';
import { api } from '../../../api/typedClient';
import { useSermonProgress } from '../useSermonProgress';
import { wrapWithQueryClient } from '../../testUtils';

jest.mock('../../../api/typedClient', () => ({
  api: { get: jest.fn() },
}));

const mockedGet = api.get as jest.Mock;

beforeEach(() => {
  mockedGet.mockReset();
});

describe('useSermonProgress', () => {
  it('calls the progress path with the sermon id', async () => {
    const progress = { sermon_id: 's1', position_seconds: 90, completed: false, play_count: 1, watched_seconds: 90, last_played_at: '2026-01-01T00:00:00Z' };
    mockedGet.mockResolvedValue(progress);

    const { result } = renderHook(() => useSermonProgress('s1'), { wrapper: wrapWithQueryClient() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(progress);
    expect(mockedGet).toHaveBeenCalledWith(
      '/sermons/{sermon_id}/progress',
      expect.objectContaining({ params: { path: { sermon_id: 's1' } } }),
    );
  });

  it('resolves null when the sermon has never been played', async () => {
    mockedGet.mockResolvedValue(null);

    const { result } = renderHook(() => useSermonProgress('s1'), { wrapper: wrapWithQueryClient() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });
});
