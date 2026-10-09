import * as SQLite from 'expo-sqlite';
import type { DownloadFailureReason, DownloadMediaType, DownloadRecord, DownloadState } from './types';

/**
 * Download-state tracking, `expo-sqlite`, own dedicated database file — per the
 * architect's writeup (status.md 2026-09-26T12:08:20Z §4) and the GATE M9 crossing:
 * "expo-sqlite for download-state tracking in its own dedicated db file (not the
 * TanStack query-cache kv-store)". `lib/query/persister.ts` opens `expo-sqlite/kv-store`
 * (a different underlying database file, managed entirely by that package) for the
 * query cache; clearing that cache must never touch a row here, and deleting a download
 * must never touch the query cache. This module reads/writes only its own file.
 *
 * Download state is genuinely relational (list by state, sum bytes, find stale
 * `downloading` rows at startup) — the architect's writeup explicitly rejected a KV blob
 * for this reason, so this uses `expo-sqlite`'s statement API directly rather than the
 * `AsyncStorage`-shaped `kv-store` wrapper `persister.ts`/`playbackPreferences.ts` use
 * for genuinely key-value data.
 */
const DB_NAME = 'rhemapod-downloads.db';

interface DownloadRow {
  sermon_id: string;
  title: string;
  thumbnail_url: string | null;
  category: string | null;
  media_type: string;
  state: string;
  progress: number;
  bytes_total: number | null;
  failure_reason: string | null;
  failure_message: string | null;
  key_id_hex: string | null;
  created_at: number;
  updated_at: number;
}

function rowToRecord(row: DownloadRow): DownloadRecord {
  return {
    sermonId: row.sermon_id,
    title: row.title,
    thumbnailUrl: row.thumbnail_url,
    category: row.category,
    mediaType: row.media_type as DownloadMediaType,
    state: row.state as DownloadState,
    progress: row.progress,
    bytesTotal: row.bytes_total,
    failureReason: row.failure_reason as DownloadFailureReason | null,
    failureMessage: row.failure_message,
    keyIdHex: row.key_id_hex,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = await SQLite.openDatabaseAsync(DB_NAME);
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS downloads (
          sermon_id TEXT PRIMARY KEY NOT NULL,
          title TEXT NOT NULL,
          state TEXT NOT NULL,
          progress REAL NOT NULL DEFAULT 0,
          bytes_total INTEGER,
          failure_reason TEXT,
          failure_message TEXT,
          key_id_hex TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
      `);
      // Migration (Isaac's ask, session 2026-10-08: video downloads). An install that
      // already has this table predates `media_type` — `CREATE TABLE IF NOT EXISTS`
      // above is a no-op against it, so the column is added here instead, guarded by a
      // `PRAGMA table_info` check: SQLite's `ALTER TABLE ADD COLUMN` errors if the
      // column already exists, and this runs on every app start. Every existing row
      // predates this feature and was always audio (the only kind downloads came in),
      // so that's the correct backfill default, not a guess.
      const columns = await db.getAllAsync<{ name: string }>('PRAGMA table_info(downloads)');
      if (!columns.some((c) => c.name === 'media_type')) {
        await db.execAsync("ALTER TABLE downloads ADD COLUMN media_type TEXT NOT NULL DEFAULT 'audio';");
      }
      // Migration (Isaac's ask, session 2026-10-09: Downloads list redesign — a real
      // thumbnail and the sermon's category replacing the generic "Downloaded" text). Both
      // nullable with no default: an install that predates this never had a thumbnail/
      // category to backfill, and `null` is already the correct "show the fallback art,
      // omit the category" rendering for those rows, not a value worth guessing.
      if (!columns.some((c) => c.name === 'thumbnail_url')) {
        await db.execAsync('ALTER TABLE downloads ADD COLUMN thumbnail_url TEXT;');
      }
      if (!columns.some((c) => c.name === 'category')) {
        await db.execAsync('ALTER TABLE downloads ADD COLUMN category TEXT;');
      }
      return db;
    })();
  }
  return dbPromise;
}

/** Test-only: drops the cached connection so the next call re-opens (and re-mocks) a fresh one. Never called by app code. */
export function __resetConnectionForTests(): void {
  dbPromise = null;
}

export async function getDownload(sermonId: string): Promise<DownloadRecord | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<DownloadRow>('SELECT * FROM downloads WHERE sermon_id = $sermonId', {
    $sermonId: sermonId,
  });
  return row ? rowToRecord(row) : null;
}

export async function listDownloads(): Promise<DownloadRecord[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<DownloadRow>('SELECT * FROM downloads ORDER BY updated_at DESC');
  return rows.map(rowToRecord);
}

/** Rows in a state a startup sweep must reconcile — the app was never running long enough to move them to `ready` or `failed` on its own. */
export async function listActiveDownloads(): Promise<DownloadRecord[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<DownloadRow>(
    "SELECT * FROM downloads WHERE state IN ('queued', 'downloading') ORDER BY created_at ASC",
  );
  return rows.map(rowToRecord);
}

/** Insert-or-replace, used to (re)start a download from a clean `queued` state — wipes any prior failure/progress for this sermon. `mediaType` is fixed at first insert (a sermon has exactly one rendition) and left untouched on a conflict/retry — a row never silently switches between audio and video. `thumbnailUrl`/`category` default to `null` (optional, not required on every caller — see `downloadManager.ts`'s own doc comment) and are refreshed on conflict same as `title`, so a retry picks up any since-changed catalog metadata. */
export async function upsertQueued(
  sermonId: string,
  title: string,
  mediaType: DownloadMediaType,
  thumbnailUrl: string | null = null,
  category: string | null = null,
): Promise<void> {
  const db = await getDb();
  const now = Date.now();
  await db.runAsync(
    `INSERT INTO downloads (sermon_id, title, thumbnail_url, category, media_type, state, progress, bytes_total, failure_reason, failure_message, key_id_hex, created_at, updated_at)
     VALUES ($sermonId, $title, $thumbnailUrl, $category, $mediaType, 'queued', 0, NULL, NULL, NULL, NULL, $now, $now)
     ON CONFLICT(sermon_id) DO UPDATE SET
       title = $title, thumbnail_url = $thumbnailUrl, category = $category, state = 'queued', progress = 0,
       bytes_total = NULL, failure_reason = NULL, failure_message = NULL, updated_at = $now`,
    {
      $sermonId: sermonId,
      $title: title,
      $thumbnailUrl: thumbnailUrl,
      $category: category,
      $mediaType: mediaType,
      $now: now,
    },
  );
}

export async function markDownloading(sermonId: string): Promise<void> {
  const db = await getDb();
  await db.runAsync("UPDATE downloads SET state = 'downloading', updated_at = $now WHERE sermon_id = $sermonId", {
    $sermonId: sermonId,
    $now: Date.now(),
  });
}

export async function updateProgress(sermonId: string, progress: number): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE downloads SET progress = $progress, updated_at = $now WHERE sermon_id = $sermonId', {
    $sermonId: sermonId,
    $progress: Math.min(1, Math.max(0, progress)),
    $now: Date.now(),
  });
}

/** `keyIdHex` is audio-only (the file it names came through `rpa-crypto`'s encrypt step) — null for a video record, which has nothing to key. */
export async function markReady(
  sermonId: string,
  fields: { bytesTotal: number; keyIdHex: string | null },
): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `UPDATE downloads SET state = 'ready', progress = 1, bytes_total = $bytesTotal, key_id_hex = $keyIdHex,
       failure_reason = NULL, failure_message = NULL, updated_at = $now WHERE sermon_id = $sermonId`,
    { $sermonId: sermonId, $bytesTotal: fields.bytesTotal, $keyIdHex: fields.keyIdHex, $now: Date.now() },
  );
}

export async function markFailed(
  sermonId: string,
  reason: DownloadFailureReason,
  message: string,
): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `UPDATE downloads SET state = 'failed', failure_reason = $reason, failure_message = $message, updated_at = $now
       WHERE sermon_id = $sermonId`,
    { $sermonId: sermonId, $reason: reason, $message: message, $now: Date.now() },
  );
}

export async function deleteDownload(sermonId: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM downloads WHERE sermon_id = $sermonId', { $sermonId: sermonId });
}
