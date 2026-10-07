import { renderHook, waitFor } from '@testing-library/react-native';
import { api } from '../../../api/typedClient';
import { useNewReleases } from '../useNewReleases';
import { wrapWithQueryClient } from '../../testUtils';

jest.mock('../../../api/typedClient', () => ({
  api: { get: jest.fn() },
}));

const mockedGet = api.get as jest.Mock;

beforeEach(() => {
  mockedGet.mockReset();
});

describe('useNewReleases', () => {
  it('resolves with the new-release sermons the fetch boundary returns', async () => {
    const items = [{ id: 's1', title: 'Fresh Sermon' }];
    mockedGet.mockResolvedValue(items);

    const { result } = renderHook(() => useNewReleases(), { wrapper: wrapWithQueryClient() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(items);
    expect(mockedGet).toHaveBeenCalledWith(
      '/catalog/sermons/new-releases',
      expect.objectContaining({ init: expect.anything() }),
    );
  });

  it('resolves with an empty array when there are no new releases', async () => {
    mockedGet.mockResolvedValue([]);

    const { result } = renderHook(() => useNewReleases(), { wrapper: wrapWithQueryClient() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });
});
