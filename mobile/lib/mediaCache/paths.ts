import * as FileSystem from 'expo-file-system';

/**
 * Media-cache file paths (plan D17). Own subfolder of `cacheDirectory`, distinct from
 * `rpa-playback-tmp/` and `rpa-download-tmp/`. `cacheDirectory` is `null` only on an
 * unsupported platform (web), so this throws a clear error there rather than building a
 * `"null/..."` path — same guard as `lib/downloads/paths.ts`.
 */

function requireCacheDir(): string {
  const dir = FileSystem.cacheDirectory;
  if (!dir) {
    throw new Error('lib/mediaCache/paths: cacheDirectory is unavailable on this platform (media cache is mobile-only)');
  }
  return dir;
}

export function mediaCacheDir(): string {
  return `${requireCacheDir()}rpa-media-cache/`;
}

export function mediaCacheFilePath(fileName: string): string {
  return `${mediaCacheDir()}${fileName}`;
}

/** D13: the in-flight companion of a cache file; renamed to the final path only after verification. */
export function mediaCachePartPath(fileName: string): string {
  return `${mediaCacheFilePath(fileName)}.part`;
}
