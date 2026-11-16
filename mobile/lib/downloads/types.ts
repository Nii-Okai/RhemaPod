/**
 * Offline downloads (plan W4.5, GATE M9; video added Isaac's ask, session 2026-10-08,
 * revisiting the GATE M9 "audio-only" lock). Shared types for the download-state store
 * (`db.ts`), the orchestrator (`downloadManager.ts`) and the UI (`useDownloads.ts`,
 * `app/(tabs)/downloads.tsx`). No license keys, no server-side download bookkeeping —
 * every field below is client-only state.
 */

/** A sermon carries exactly one rendition (video or audio, never both) — this is which
 * one a given download record is for, and therefore which protection it gets at rest:
 * audio is JS-level encrypted (`rpa-crypto`, decrypted to a temp file only at playback
 * time); video is a plain file under the OS's own sandbox/file protection only (Isaac's
 * call — `expo-video` needs to read a format it recognizes directly, which a
 * custom-encrypted blob isn't). */
export type DownloadMediaType = 'audio' | 'video';

/**
 * `queued` — waiting on Wi-Fi (Wi-Fi-only is on and the device isn't on Wi-Fi) or simply
 *   not yet started.
 * `downloading` — actively fetching the plaintext media and/or (audio only) encrypting it.
 * `ready` — the file is on disk and has passed its post-write check (RPA1 header for
 *   audio; a non-zero file size for video, which has no header to validate).
 * `failed` — see `failureReason` for why; always recoverable via retry (re-download from
 *   scratch), never by resuming a corrupt or partial artifact.
 */
export type DownloadState = 'queued' | 'downloading' | 'ready' | 'failed';

/**
 * Every distinguishable way a download can fail, surfaced to the UI as a specific,
 * human-readable reason (plan W4.5 verification: "an interrupted download surfaces the
 * failure and recovers on Retry" — a generic "Download failed" would not satisfy that).
 */
export type DownloadFailureReason =
  | 'no_audio' // backend 409 on /download/audio — this sermon has no audio rendition
  | 'no_video' // backend 409 on /download/video — this sermon has no video rendition
  | 'network' // the request never reached the server, or the transfer dropped mid-stream
  | 'interrupted' // the app was killed/backgrounded-and-reaped mid-download (found by the startup sweep)
  | 'disk' // ran out of space, or a filesystem write failed
  | 'encryption' // the native encrypt step itself failed (audio only; should be rare; still surfaced distinctly)
  | 'corrupt' // the encrypted file on disk failed RPA1 validation (audio only — truncated or tampered)
  | 'key_lost' // SecureStore no longer has the install key that encrypted this file (audio only — reinstall, wipe)
  | 'cancelled' // the user cancelled an in-flight download
  | 'unknown';

export interface DownloadRecord {
  sermonId: string;
  /** Denormalized for the list screen so it never needs a second fetch to render a title while offline. */
  title: string;
  /** Same reasoning as `title` — the Downloads tab's own thumbnail (session 2026-10-09
   * redesign) reads this, not a second fetch. `null` for a sermon with no thumbnail, same
   * as `SermonListItem.thumbnail_url` upstream. */
  thumbnailUrl: string | null;
  /** A local, permanent copy of the thumbnail image, fetched once alongside the media
   * (session 2026-10-15 fix) — `thumbnailUrl` is a presigned S3 URL with a ~6h expiry that
   * is never re-signed once a download is `ready`, so render this first when set; `null`
   * until that fetch completes (or if it failed), in which case callers fall back to
   * `thumbnailUrl` same as before this fix. */
  thumbnailPath: string | null;
  /** The sermon's `category_name` at the moment it was queued, denormalized the same way —
   * replaces the Downloads list's old generic "Downloaded" label with the actual category
   * (session 2026-10-09 redesign). `null` for an uncategorized sermon. */
  category: string | null;
  mediaType: DownloadMediaType;
  state: DownloadState;
  /** 0–1, meaningful only while `state === 'downloading'`. */
  progress: number;
  /** Total file size once known (post-encrypt for audio, post-fetch for video), for the "X of Y" storage summary. */
  bytesTotal: number | null;
  failureReason: DownloadFailureReason | null;
  /** Set only when `failureReason` is set — a short, already-human-readable sentence for the UI, not a code. */
  failureMessage: string | null;
  /** Hex key id the file was encrypted under (from the native `encryptFile` result) — audio only, always null for a video record; bookkeeping only, never used to gate decrypt (the native module already checks this internally). */
  keyIdHex: string | null;
  createdAt: number;
  updatedAt: number;
}

export const ACTIVE_STATES: readonly DownloadState[] = ['queued', 'downloading'];
