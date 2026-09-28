import * as SQLite from 'expo-sqlite';
import type { DownloadFailureReason, DownloadRecord, DownloadState } from './types';

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

/** Insert-or-replace, used to (re)start a download from a clean `queued` state — wipes any prior failure/progress for this sermon. */
export async function upsertQueued(sermonId: string, title: string): Promise<void> {
  const db = await getDb();
  const now = Date.now();
  await db.runAsync(
    `INSERT INTO downloads (sermon_id, title, state, progress, bytes_total, failure_reason, failure_message, key_id_hex, created_at, updated_at)
     VALUES ($sermonId, $title, 'queued', 0, NULL, NULL, NULL, NULL, $now, $now)
     ON CONFLICT(sermon_id) DO UPDATE SET
       title = $title, state = 'queued', progress = 0, bytes_total = NULL,
       failure_reason = NULL, failure_message = NULL, updated_at = $now`,
    { $sermonId: sermonId, $title: title, $now: now },
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

export async function markReady(
  sermonId: string,
  fields: { bytesTotal: number; keyIdHex: string },
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
