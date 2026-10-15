import * as SQLite from 'expo-sqlite';

/**
 * Media-cache manifest (plan D10, D12). Its own `expo-sqlite` file, separate from the
 * Downloads database and schema. Deliberately has no URL, query or token column: a row
 * is only ids, an opaque file name, a size and two timestamps.
 */
const DB_NAME = 'rpa-media-cache.db';

export interface ManifestEntry {
  mediaRefId: string;
  sermonId: string;
  fileName: string;
  sizeBytes: number;
  lastAccessedAt: number;
  createdAt: number;
}

interface ManifestRow {
  media_ref_id: string;
  sermon_id: string;
  file_name: string;
  size_bytes: number;
  last_accessed_at: number;
  created_at: number;
}

function rowToEntry(row: ManifestRow): ManifestEntry {
  return {
    mediaRefId: row.media_ref_id,
    sermonId: row.sermon_id,
    fileName: row.file_name,
    sizeBytes: row.size_bytes,
    lastAccessedAt: row.last_accessed_at,
    createdAt: row.created_at,
  };
}

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    const opening = (async () => {
      const db = await SQLite.openDatabaseAsync(DB_NAME);
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS media_cache (
          media_ref_id TEXT PRIMARY KEY NOT NULL,
          sermon_id TEXT NOT NULL,
          file_name TEXT NOT NULL,
          size_bytes INTEGER NOT NULL,
          last_accessed_at INTEGER NOT NULL,
          created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_media_cache_sermon ON media_cache (sermon_id);
      `);
      return db;
    })();
    dbPromise = opening;
    // A failed open must not be cached forever; the next call retries.
    opening.catch(() => {
      if (dbPromise === opening) dbPromise = null;
    });
  }
  return dbPromise;
}

export async function get(mediaRefId: string): Promise<ManifestEntry | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<ManifestRow>('SELECT * FROM media_cache WHERE media_ref_id = $id', {
    $id: mediaRefId,
  });
  return row ? rowToEntry(row) : null;
}

/** Inserts, or replaces the existing row for the same `media_ref_id` (never a duplicate). */
export async function insert(entry: ManifestEntry): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO media_cache (media_ref_id, sermon_id, file_name, size_bytes, last_accessed_at, created_at)
     VALUES ($id, $sermonId, $fileName, $sizeBytes, $lastAccessedAt, $createdAt)
     ON CONFLICT(media_ref_id) DO UPDATE SET
       sermon_id = excluded.sermon_id,
       file_name = excluded.file_name,
       size_bytes = excluded.size_bytes,
       last_accessed_at = excluded.last_accessed_at,
       created_at = excluded.created_at`,
    {
      $id: entry.mediaRefId,
      $sermonId: entry.sermonId,
      $fileName: entry.fileName,
      $sizeBytes: entry.sizeBytes,
      $lastAccessedAt: entry.lastAccessedAt,
      $createdAt: entry.createdAt,
    },
  );
}

/** Updates `last_accessed_at` only. */
export async function touch(mediaRefId: string, now: number): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE media_cache SET last_accessed_at = $now WHERE media_ref_id = $id', {
    $now: now,
    $id: mediaRefId,
  });
}

export async function deleteByKey(mediaRefId: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM media_cache WHERE media_ref_id = $id', { $id: mediaRefId });
}

/** Deletes every row for a sermon and returns them, so the caller can remove the files. */
export async function deleteBySermon(sermonId: string): Promise<ManifestEntry[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<ManifestRow>('SELECT * FROM media_cache WHERE sermon_id = $sermonId', {
    $sermonId: sermonId,
  });
  await db.runAsync('DELETE FROM media_cache WHERE sermon_id = $sermonId', { $sermonId: sermonId });
  return rows.map(rowToEntry);
}

/** Least-recently-used first; ties broken by `created_at`, then `media_ref_id`, for a deterministic order. */
export async function listByLru(): Promise<ManifestEntry[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<ManifestRow>(
    'SELECT * FROM media_cache ORDER BY last_accessed_at ASC, created_at ASC, media_ref_id ASC',
  );
  return rows.map(rowToEntry);
}

export async function totalBytes(): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ total: number | null }>(
    'SELECT COALESCE(SUM(size_bytes), 0) AS total FROM media_cache',
  );
  return row?.total ?? 0;
}

/** Closes the connection; the next operation re-opens. */
export async function close(): Promise<void> {
  const pending = dbPromise;
  dbPromise = null;
  if (!pending) return;
  const db = await pending.catch(() => null);
  if (db) await db.closeAsync();
}

/** Closes the connection, then deletes the `.db` file itself (plan S7) — `close()` alone
 * leaves the file on disk; the next manifest operation after this recreates it fresh. */
export async function deleteDatabaseFile(): Promise<void> {
  await close();
  await SQLite.deleteDatabaseAsync(DB_NAME);
}
