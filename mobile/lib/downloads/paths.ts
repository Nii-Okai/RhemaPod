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

/** The final, plain (unencrypted — see `types.ts`'s own doc comment on `DownloadMediaType`)
 * video file — lives in the same `downloadsDir` as audio's `.rpa1` files, distinguished by
 * extension, so the one startup sweep / storage-summary walk over that directory already
 * covers both kinds without a second directory to manage. */
export function videoFilePath(sermonId: string): string {
  return `${downloadsDir()}${sermonId}.mp4`;
}

export function tmpDownloadFilePath(sermonId: string): string {
  return `${downloadTmpDir()}${sermonId}.audio.tmp`;
}

/** Video has no separate encrypt pass (plain fetch straight to its final path), so unlike
 * audio it needs no plaintext-staging tmp file at all in steady state — this exists only
 * for the download itself to resume into before the atomic rename to `videoFilePath`,
 * mirroring `tmpDownloadFilePath`'s role for audio's own plaintext-before-encrypt stage. */
export function tmpDownloadVideoFilePath(sermonId: string): string {
  return `${downloadTmpDir()}${sermonId}.video.tmp`;
}

/** A fresh, unpredictable filename per playback session — never reused, so a stale decrypted file from a crash never collides with (or gets mistaken for) a new one. */
export function playbackTempFilePath(sermonId: string): string {
  const random = Math.random().toString(36).slice(2) + Date.now().toString(36);
  return `${playbackTmpDir()}${sermonId}-${random}.pcm-tmp`;
}

/**
 * The native module's own atomic-write companion path (`dstUri + '.part'`, see both
 * `RpaCryptoModule.swift`/`.kt`'s `encryptFile`/`decryptFile`) — written first, then
 * renamed to the real path on success. A process kill strictly between those two steps
 * leaves this file behind, at this exact path, forever, unless something targets it
 * explicitly. Every cleanup call site that deletes an encrypted or decrypted-playback
 * path must delete this companion too, not just the final path.
 */
export function partFilePath(uri: string): string {
  return `${uri}.part`;
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

/**
 * Deletes every file directly inside `dir` (non-recursive — every directory this module
 * manages is flat), tolerating a directory that doesn't exist yet. Used at startup to
 * clear the entire playback-temp directory unconditionally — every file there is a
 * single-playback-session artifact by construction (see `playbackTempFilePath`'s random
 * name), so unlike the downloads/download-tmp directories (reconciled row-by-row against
 * the DB in `startupSweep`), nothing here is ever worth keeping across an app restart.
 */
export async function clearDirectoryContents(dir: string): Promise<void> {
  const info = await FileSystem.getInfoAsync(dir);
  if (!info.exists) return;
  const entries = await FileSystem.readDirectoryAsync(dir);
  await Promise.all(entries.map((name) => FileSystem.deleteAsync(`${dir}${name}`, { idempotent: true })));
}
