import { renderHook, waitFor } from '@testing-library/react-native';
import { api } from '../../../api/typedClient';
import { ApiError } from '../../../api/errors';
import { useSpeakers } from '../useSpeakers';
import { wrapWithQueryClient } from '../../testUtils';

jest.mock('../../../api/typedClient', () => ({
  api: { get: jest.fn() },
}));

const mockedGet = api.get as jest.Mock;

beforeEach(() => {
  mockedGet.mockReset();
});

describe('useSpeakers', () => {
  it('resolves with the speakers the fetch boundary returns, bio included', async () => {
    const speakers = [
      { id: 's1', name: 'Ada Nwosu', bio: 'Lead pastor at Grace Chapel since 2014', sermon_count: 61 },
      { id: 's2', name: 'Ruth Mensah', bio: null, sermon_count: 11 },
    ];
    mockedGet.mockResolvedValue(speakers);

    const { result } = renderHook(() => useSpeakers(), { wrapper: wrapWithQueryClient() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(speakers);
    expect(mockedGet).toHaveBeenCalledWith('/speakers', expect.objectContaining({ init: expect.anything() }));
  });

  it('surfaces a fetch-boundary failure as an error state', async () => {
    mockedGet.mockRejectedValue(new ApiError(0, 'Could not reach the server. Check your connection.', null, true));

    const { result } = renderHook(() => useSpeakers(), { wrapper: wrapWithQueryClient() });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as ApiError).network).toBe(true);
  });
});
