import { act, renderHook, waitFor } from '@testing-library/react-native';
import { api } from '../../../api/typedClient';
import { ApiError } from '../../../api/errors';
import { queryKeys } from '../../queryClient';
import { createTestQueryClient, wrapWithQueryClient } from '../../testUtils';
import { useMyBlocks, useUnblock } from '../useBlocks';

jest.mock('../../../api/typedClient', () => ({
  api: { get: jest.fn(), delete: jest.fn() },
}));

const mockedGet = api.get as jest.Mock;
const mockedDelete = api.delete as jest.Mock;

const blocks = [
  { id: 'b1', display_name: 'Pat Q.', created_at: '2026-10-01T00:00:00Z' },
  { id: 'b2', display_name: 'Lee R.', created_at: '2026-10-01T00:00:00Z' },
];

beforeEach(() => {
  mockedGet.mockReset();
  mockedDelete.mockReset();
  mockedGet.mockResolvedValue(blocks);
});

describe('useMyBlocks', () => {
  it('reads GET /me/blocks', async () => {
    const { result } = renderHook(() => useMyBlocks(), { wrapper: wrapWithQueryClient() });
    await waitFor(() => expect(result.current.data).toEqual(blocks));
    expect(mockedGet).toHaveBeenCalledWith('/me/blocks', expect.anything());
  });
});

describe('useUnblock', () => {
  it('removes the block and calls DELETE /me/blocks/{id}', async () => {
    const client = createTestQueryClient();
    const list = renderHook(() => useMyBlocks(), { wrapper: wrapWithQueryClient(client) });
    await waitFor(() => expect(list.result.current.isSuccess).toBe(true));

    mockedGet.mockResolvedValue([blocks[1]]);
    mockedDelete.mockResolvedValue(undefined);
    const { result } = renderHook(() => useUnblock(), { wrapper: wrapWithQueryClient(client) });
    await act(async () => {
      await result.current.mutateAsync('b1');
    });
    expect(mockedDelete).toHaveBeenCalledWith('/me/blocks/{block_id}', { params: { path: { block_id: 'b1' } } });
    await waitFor(() => expect(client.getQueryData(queryKeys.me.blocks())).toEqual([blocks[1]]));
  });

  it('removes optimistically, then puts the row back when the request fails', async () => {
    const client = createTestQueryClient();
    const list = renderHook(() => useMyBlocks(), { wrapper: wrapWithQueryClient(client) });
    await waitFor(() => expect(list.result.current.isSuccess).toBe(true));

    let rejectDelete: (e: unknown) => void = () => {};
    mockedDelete.mockReturnValue(new Promise((_, reject) => (rejectDelete = reject)));
    const { result } = renderHook(() => useUnblock(), { wrapper: wrapWithQueryClient(client) });
    act(() => result.current.mutate('b1'));
    await waitFor(() => expect(client.getQueryData(queryKeys.me.blocks())).toEqual([blocks[1]]));

    await act(async () => rejectDelete(new ApiError(500, 'boom')));
    await waitFor(() => expect(result.current.isError).toBe(true));
    await waitFor(() => expect(client.getQueryData(queryKeys.me.blocks())).toEqual(blocks));
  });
});
