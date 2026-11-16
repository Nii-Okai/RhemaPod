import * as FileSystem from 'expo-file-system';
import * as manifest from './manifest';
import * as paths from './paths';
import { invalidateInFlightFills } from './fill';
import { emitCacheEvent } from './events';

/**
 * The sign-out wipe (plan S7, P6, behind `[HUMAN_GATE G2]`). Called from
 * `lib/auth/session.ts`'s `clearSession()` — reached by a voluntary `signOut()` and both
 * forced sign-out paths on refresh failure, so a device's cache never survives into a
 * different signed-in user. Every step is best-effort: a wipe that can't fully complete
 * must never throw into the auth path, and must never stop the tokens themselves from
 * being cleared (which happens in `clearSession()` before this is even called).
 */

export interface ClearMediaCacheDeps {
  invalidateInFlightFills: typeof invalidateInFlightFills;
  deleteDatabaseFile: typeof manifest.deleteDatabaseFile;
  deleteDir: (uri: string) => Promise<void>;
}

async function realDeleteDir(uri: string): Promise<void> {
  await FileSystem.deleteAsync(uri, { idempotent: true });
}

function defaultDeps(): ClearMediaCacheDeps {
  return {
    invalidateInFlightFills,
    deleteDatabaseFile: manifest.deleteDatabaseFile,
    deleteDir: realDeleteDir,
  };
}

export async function clearMediaCache(deps: ClearMediaCacheDeps = defaultDeps()): Promise<void> {
  // P6: bump the generation and cancel whatever's in flight *first* — a fill whose
  // transfer resolves after this point must discard its result, never resurrect a row
  // into the manifest file we're about to delete anyway.
  deps.invalidateInFlightFills();
  await deps.deleteDatabaseFile().catch(() => {});
  await deps.deleteDir(paths.mediaCacheDir()).catch(() => {});
  emitCacheEvent('wipe');
}
