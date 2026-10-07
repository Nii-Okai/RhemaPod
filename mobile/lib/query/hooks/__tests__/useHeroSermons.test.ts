import { renderHook, waitFor } from '@testing-library/react-native';
import { api } from '../../../api/typedClient';
import { useHeroSermons } from '../useHeroSermons';
import { wrapWithQueryClient } from '../../testUtils';

jest.mock('../../../api/typedClient', () => ({
  api: { get: jest.fn() },
}));

const mockedGet = api.get as jest.Mock;

beforeEach(() => {
  mockedGet.mockReset();
});

describe('useHeroSermons', () => {
  it('resolves with the hero sermons the fetch boundary returns', async () => {
    const items = [{ id: 's1', title: 'Newest Sermon' }];
    mockedGet.mockResolvedValue(items);

    const { result } = renderHook(() => useHeroSermons(), { wrapper: wrapWithQueryClient() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(items);
    expect(mockedGet).toHaveBeenCalledWith(
      '/catalog/sermons/hero',
      expect.objectContaining({ init: expect.anything() }),
    );
  });

  it('resolves with an empty array when there are no sermons yet', async () => {
    mockedGet.mockResolvedValue([]);

    const { result } = renderHook(() => useHeroSermons(), { wrapper: wrapWithQueryClient() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });
});
