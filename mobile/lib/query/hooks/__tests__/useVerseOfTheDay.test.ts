import { renderHook, waitFor } from '@testing-library/react-native';
import { api } from '../../../api/typedClient';
import { useVerseOfTheDay } from '../useVerseOfTheDay';
import { wrapWithQueryClient } from '../../testUtils';
import { ApiError } from '../../../api/errors';

jest.mock('../../../api/typedClient', () => ({
  api: { get: jest.fn() },
}));

const mockedGet = api.get as jest.Mock;

beforeEach(() => {
  mockedGet.mockReset();
});

describe('useVerseOfTheDay', () => {
  it('resolves with the verse the fetch boundary returns', async () => {
    const verse = { id: 'v1', reference: 'Philippians 4:13', text: 'I can do all things...', translation: 'kjv' };
    mockedGet.mockResolvedValue(verse);

    const { result } = renderHook(() => useVerseOfTheDay(), { wrapper: wrapWithQueryClient() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(verse);
    expect(mockedGet).toHaveBeenCalledWith('/verses/today', expect.objectContaining({ init: expect.anything() }));
  });

  it('surfaces a 404 (no active verses) as an error, not a crash', async () => {
    mockedGet.mockRejectedValue(new ApiError(404, 'No verses available'));

    const { result } = renderHook(() => useVerseOfTheDay(), { wrapper: wrapWithQueryClient() });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
