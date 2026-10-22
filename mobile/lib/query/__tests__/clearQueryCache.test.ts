import { clearQueryCache } from '../clearQueryCache';
import { sqliteQueryPersister } from '../persister';
import { queryClient } from '../queryClient';

jest.mock('../persister', () => ({
  sqliteQueryPersister: { persistClient: jest.fn(), restoreClient: jest.fn(), removeClient: jest.fn() },
}));

const removeClient = sqliteQueryPersister.removeClient as jest.Mock;

beforeEach(() => {
  removeClient.mockReset();
  queryClient.clear();
});

it('drops every cached query and the persisted copy', async () => {
  queryClient.setQueryData(['me', 'profile'], { email: 'a@example.com' });
  removeClient.mockResolvedValue(undefined);

  await clearQueryCache();

  expect(queryClient.getQueryData(['me', 'profile'])).toBeUndefined();
  expect(removeClient).toHaveBeenCalledTimes(1);
});

it('never throws when the persisted copy cannot be removed', async () => {
  removeClient.mockRejectedValue(new Error('disk'));
  await expect(clearQueryCache()).resolves.toBeUndefined();
});
