import * as FileSystem from 'expo-file-system';

/**
 * File-path conventions for offline downloads (plan W4.5). Three distinct directories,
 * matching the architect's writeup's own separation (status.md 2026-09-26T12:08:20Z §2,
 * §4):
 *  - `downloadsDir` (`documentDirectory`, survives until explicitly deleted): the final
 *    RPA1-encrypted files. User data, not cache — the OS must never reclaim these under
 *    storage pressure without the app knowing, or a `ready` DB row would silently start
 *    lying about what's on disk.
 *  - `downloadTmpDir` (`cacheDirectory`): plaintext audio mid-fetch, before encryption.
 *    Cache, not documents — this is exactly the kind of file the OS is allowed to reap,
 *    and the startup sweep treats anything found here as abandoned work regardless.
 *  - `playbackTmpDir` (`cacheDirectory`): the path-A decrypt-to-temp-file mitigation
 *    (same writeup, §4): a random-per-session filename, deleted on stop/track-change and
 *    swept clean on every app start (a crash can otherwise leave one file behind).
 *
 * `documentDirectory`/`cacheDirectory` are `null` only on an unsupported platform (web) —
 * every function here is guarded so it throws a clear error on web (offline downloads are
 * mobile-only) rather than silently building a `"null/..."` path string.
 */

function requireDir(dir: string | null, label: string): string {
  if (!dir) {
    throw new Error(`lib/downloads/paths: ${label} is unavailable on this platform (offline downloads are mobile-only)`);
  }
  return dir;
}

export function downloadsDir(): string {
  return `${requireDir(FileSystem.documentDirectory, 'documentDirectory')}rpa-downloads/`;
}

export function downloadTmpDir(): string {
  return `${requireDir(FileSystem.cacheDirectory, 'cacheDirectory')}rpa-download-tmp/`;
}

export function playbackTmpDir(): string {
  return `${requireDir(FileSystem.cacheDirectory, 'cacheDirectory')}rpa-playback-tmp/`;
}

export function encryptedFilePath(sermonId: string): string {
  return `${downloadsDir()}${sermonId}.rpa1`;
}

export function tmpDownloadFilePath(sermonId: string): string {
  return `${downloadTmpDir()}${sermonId}.audio.tmp`;
}

/** A fresh, unpredictable filename per playback session — never reused, so a stale decrypted file from a crash never collides with (or gets mistaken for) a new one. */
export function playbackTempFilePath(sermonId: string): string {
  const random = Math.random().toString(36).slice(2) + Date.now().toString(36);
  return `${playbackTmpDir()}${sermonId}-${random}.pcm-tmp`;
}

export async function ensureDir(dir: string): Promise<void> {
  const info = await FileSystem.getInfoAsync(dir);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  }
}

/** Deletes a file if it exists; a no-op (never throws) if it doesn't — every cleanup call site wants this, not a `getInfoAsync` + `deleteAsync` pair repeated everywhere. */
export async function deleteIfExists(uri: string): Promise<void> {
  await FileSystem.deleteAsync(uri, { idempotent: true });
}
