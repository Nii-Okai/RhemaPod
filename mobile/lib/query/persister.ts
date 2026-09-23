import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import type { Persister } from '@tanstack/react-query-persist-client';
import { AsyncStorage as SQLiteAsyncStorage } from 'expo-sqlite/kv-store';

/**
 * Persistence over `expo-sqlite` (plan L16, §A.8) for offline catalogue
 * browsing. `@tanstack/query-async-storage-persister` is a *storage-shape*
 * persister, not a web-specific one on its own — it only needs something
 * matching the `AsyncStorage<string>` interface (`getItem`/`setItem`/
 * `removeItem`). The web-oriented instinct is to reach for
 * `@react-native-async-storage/async-storage` (an unencrypted flat-file
 * store) to satisfy that; instead this pairs the persister with
 * `expo-sqlite/kv-store`'s `AsyncStorage` export — a SQLite-backed
 * implementation of that exact interface, shipped by `expo-sqlite` itself
 * since it became the Expo-recommended AsyncStorage replacement. Net
 * effect: the persisted query cache actually lives in a SQLite database on
 * disk, satisfying L16, without hand-rolling a custom persister against
 * `expo-sqlite`'s lower-level `openDatabaseAsync`/statement API.
 *
 * `MAX_AGE_MS` must not exceed `queryClient.ts`'s `gcTime` — TanStack Query
 * garbage-collects any query past `gcTime` before persistence ever gets a
 * chance to write it back out, so a persister `maxAge` longer than
 * `gcTime` can never actually be reached.
 */
export const MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24h

export const sqliteQueryPersister: Persister = createAsyncStoragePersister({
  storage: SQLiteAsyncStorage,
  key: 'rhemapod-query-cache',
  throttleTime: 1000,
});
