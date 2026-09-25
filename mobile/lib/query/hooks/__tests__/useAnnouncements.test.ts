import { renderHook, waitFor } from '@testing-library/react-native';
import { api } from '../../../api/typedClient';
import { useAnnouncements } from '../useAnnouncements';
import { wrapWithQueryClient } from '../../testUtils';

jest.mock('../../../api/typedClient', () => ({
  api: { get: jest.fn() },
}));

const mockedGet = api.get as jest.Mock;

beforeEach(() => {
  mockedGet.mockReset();
});

describe('useAnnouncements', () => {
  it('calls GET /announcements with no query params — the server already windows/orders it', async () => {
    mockedGet.mockResolvedValue([]);
    const { result } = renderHook(() => useAnnouncements(), { wrapper: wrapWithQueryClient() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedGet).toHaveBeenCalledWith('/announcements', expect.objectContaining({ init: expect.anything() }));
  });
});
