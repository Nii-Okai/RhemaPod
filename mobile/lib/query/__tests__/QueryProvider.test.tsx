import { QueryClient } from '@tanstack/react-query';
import { PERSIST_BUSTER, shouldPersistMutation, shouldPersistQuery } from '../QueryProvider';
import { queryKeys } from '../queryClient';

jest.mock('expo-sqlite/kv-store', () => ({
  AsyncStorage: { getItem: jest.fn(async () => null), setItem: jest.fn(async () => undefined), removeItem: jest.fn() },
}));

function queryFor(key: readonly unknown[]) {
  const client = new QueryClient();
  client.setQueryData(key, { ok: true });
  return client.getQueryCache().find({ queryKey: key })!;
}

describe('QueryProvider persistence', () => {
  it('carries a buster so the pre-comments cache (with its Notes entries) is discarded on upgrade', () => {
    expect(PERSIST_BUSTER).toBe('sermon-comments-1');
  });

  it('keeps persisting catalogue queries', () => {
    expect(shouldPersistQuery(queryFor(queryKeys.me.profile()))).toBe(true);
    expect(shouldPersistQuery(queryFor(queryKeys.progress.detail('s1')))).toBe(true);
  });

  it('never writes comment threads or the blocked-users list to disk', () => {
    expect(shouldPersistQuery(queryFor(queryKeys.comments.forSermon('s1')))).toBe(false);
    expect(shouldPersistQuery(queryFor(queryKeys.me.blocks()))).toBe(false);
  });

  it('never writes /stream responses to disk (S8/S9 review, B1/D11/D2 — a restored stale entitlement confirmation must not be possible)', () => {
    expect(shouldPersistQuery(queryFor(queryKeys.stream.detail('s1')))).toBe(false);
  });

  it('never dehydrates a mutation, so a paused comment-post never lands in the on-disk cache', () => {
    // No mutation shape needed: every mutation is excluded regardless of its payload.
    expect(shouldPersistMutation()).toBe(false);
  });
});
