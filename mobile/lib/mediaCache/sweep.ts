import * as FileSystem from 'expo-file-system';
import * as manifest from './manifest';
import * as paths from './paths';
import { emitCacheEvent } from './events';

/**
 * Startup reconciliation (plan S5, D14). Single-flight per app launch — the first caller
 * (whichever `useCachedSource` lookup happens first) triggers it, every other caller in
 * the same launch awaits the same promise, and it never runs a second time after that,
 * success or failure. A failure here is swallowed (best effort): a sweep that can't run
 * must never block ordinary cache access. Deliberately NOT part of Downloads' own
 * `startupSweep()` — a different directory, a different database, a different failure
 * domain.
 */

export interface SweepDeps {
  listByLru: typeof manifest.listByLru;
  deleteByKey: typeof manifest.deleteByKey;
  listDir: (dirUri: string) => Promise<string[]>;
  getSize: (uri: string) => Promise<number>;
  deleteFile: (uri: string) => Promise<void>;
}

async function realListDir(dirUri: string): Promise<string[]> {
  try {
    return await FileSystem.readDirectoryAsync(dirUri);
  } catch {
    // Missing/never-created directory reads as "nothing to sweep", not an error.
    return [];
  }
}

async function realGetSize(uri: string): Promise<number> {
  const info = await FileSystem.getInfoAsync(uri, { size: true });
  return info.exists && !info.isDirectory ? (info.size ?? 0) : 0;
}

async function realDeleteFile(uri: string): Promise<void> {
  await FileSystem.deleteAsync(uri, { idempotent: true });
}

function defaultDeps(): SweepDeps {
  return {
    listByLru: manifest.listByLru,
    deleteByKey: manifest.deleteByKey,
    listDir: realListDir,
    getSize: realGetSize,
    deleteFile: realDeleteFile,
  };
}

async function runSweep(deps: SweepDeps): Promise<void> {
  const [entries, fileNames] = await Promise.all([deps.listByLru(), deps.listDir(paths.mediaCacheDir())]);
  const fileSet = new Set(fileNames);
  const knownFileNames = new Set<string>();

  for (const entry of entries) {
    if (!fileSet.has(entry.fileName)) {
      // The file is gone (the OS can purge `cacheDirectory` at any time) — just drop the
      // stale row, there's nothing left to delete.
      await deps.deleteByKey(entry.mediaRefId).catch(() => {});
      continue;
    }
    knownFileNames.add(entry.fileName);

    const actualSize = await deps.getSize(paths.mediaCacheFilePath(entry.fileName)).catch(() => -1);
    if (actualSize !== entry.sizeBytes) {
      await deps.deleteByKey(entry.mediaRefId).catch(() => {});
      await deps.deleteFile(paths.mediaCacheFilePath(entry.fileName)).catch(() => {});
      knownFileNames.delete(entry.fileName);
    }
  }

  // Anything on disk with no (still-valid) row is an orphan: a `.part` left by a crashed
  // fill, or a final file whose row was just dropped above.
  for (const fileName of fileNames) {
    if (knownFileNames.has(fileName)) continue;
    await deps.deleteFile(paths.mediaCacheFilePath(fileName)).catch(() => {});
  }

  emitCacheEvent('sweep');
}

let sweptThisLaunch: Promise<void> | null = null;

/** Runs the sweep once per app launch; every call after the first awaits the same result. */
export function ensureSwept(deps: SweepDeps = defaultDeps()): Promise<void> {
  if (!sweptThisLaunch) {
    sweptThisLaunch = runSweep(deps).catch(() => {});
  }
  return sweptThisLaunch;
}

/** Test-only: lets a fresh test start a fresh "launch". Never called from app code. */
export function resetSweptForTests(): void {
  sweptThisLaunch = null;
}
