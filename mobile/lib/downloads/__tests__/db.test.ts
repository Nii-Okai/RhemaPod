/**
 * `../db.ts` unit coverage against a purpose-built in-memory fake of `expo-sqlite`'s
 * statement API — real SQLite doesn't run under Jest/Node (no native bridge), so, exactly
 * like this repo's existing `lib/query/__tests__/persister.test.tsx` (which fakes
 * `expo-sqlite/kv-store`'s `AsyncStorage` shape), this fakes just enough of
 * `SQLiteDatabase` (`execAsync`/`runAsync`/`getFirstAsync`/`getAllAsync`) to exercise
 * `db.ts`'s own SQL and parameter-binding logic end to end, keyed off the same statement
 * shapes `db.ts` actually issues. This does not (and cannot, in this sandbox) prove the
 * real native SQLite engine parses these exact strings — that gap is named plainly in
 * the mobile-developer status entry, same as every other native-module gap in this task.
 */
import * as SQLite from 'expo-sqlite';
import {
  __resetConnectionForTests,
  deleteDownload,
  getDownload,
  listActiveDownloads,
  listDownloads,
  markDownloading,
  markFailed,
  markReady,
  getDetailSnapshot,
  listReadyMissingDetail,
  setDetailSnapshot,
  setThumbnailPath,
  updateProgress,
  upsertQueued,
} from '../db';

interface FakeRow {
  sermon_id: string;
  title: string;
  media_type: string;
  thumbnail_path: string | null;
  detail_json?: string | null;
  state: string;
  progress: number;
  bytes_total: number | null;
  failure_reason: string | null;
  failure_message: string | null;
  key_id_hex: string | null;
  created_at: number;
  updated_at: number;
}

function makeFakeDatabase() {
  const rows = new Map<string, FakeRow>();

  return {
    execAsync: jest.fn(async () => undefined),
    runAsync: jest.fn(async (sql: string, params: Record<string, unknown>) => {
      const sermonId = params.$sermonId as string;
      if (sql.includes('INSERT INTO downloads')) {
        const now = params.$now as number;
        const existing = rows.get(sermonId);
        rows.set(sermonId, {
          sermon_id: sermonId,
          title: params.$title as string,
          media_type: existing?.media_type ?? (params.$mediaType as string),
          thumbnail_path: existing?.thumbnail_path ?? null,
          state: 'queued',
          progress: 0,
          bytes_total: null,
          failure_reason: null,
          failure_message: null,
          key_id_hex: existing?.key_id_hex ?? null,
          created_at: existing?.created_at ?? now,
          updated_at: now,
        });
      } else if (sql.includes("state = 'downloading'")) {
        const row = rows.get(sermonId);
        if (row) {
          row.state = 'downloading';
          row.updated_at = params.$now as number;
        }
      } else if (sql.includes('progress = $progress')) {
        const row = rows.get(sermonId);
        if (row) {
          row.progress = params.$progress as number;
          row.updated_at = params.$now as number;
        }
      } else if (sql.includes("state = 'ready'")) {
        const row = rows.get(sermonId);
        if (row) {
          row.state = 'ready';
          row.progress = 1;
          row.bytes_total = params.$bytesTotal as number;
          row.key_id_hex = params.$keyIdHex as string;
          row.failure_reason = null;
          row.failure_message = null;
          row.updated_at = params.$now as number;
        }
      } else if (sql.includes('thumbnail_path = $path')) {
        const row = rows.get(sermonId);
        if (row) {
          row.thumbnail_path = params.$path as string | null;
          row.updated_at = params.$now as number;
        }
        // Unlike every other branch here, `setThumbnailPath`'s own `changes > 0` return
        // value is load-bearing (the reviewer-gilfoyle-found orphan-file race fix in
        // `downloadManager.ts`), so this is the one statement in this fake whose `changes`
        // count must genuinely reflect whether a row existed, not just always report 1.
        return { changes: row ? 1 : 0, lastInsertRowId: 0 };
      } else if (sql.includes('detail_json = $detailJson')) {
        const row = rows.get(sermonId);
        if (row) row.detail_json = params.$detailJson as string;
        return { changes: row ? 1 : 0, lastInsertRowId: 0 };
      } else if (sql.includes("state = 'failed'")) {
        const row = rows.get(sermonId);
        if (row) {
          row.state = 'failed';
          row.failure_reason = params.$reason as string;
          row.failure_message = params.$message as string;
          row.updated_at = params.$now as number;
        }
      } else if (sql.includes('DELETE FROM downloads')) {
        rows.delete(sermonId);
      } else {
        throw new Error(`FakeDatabase: unrecognized runAsync statement: ${sql}`);
      }
      return { changes: 1, lastInsertRowId: 0 };
    }),
    getFirstAsync: jest.fn(async (_sql: string, params: Record<string, unknown>) => {
      return rows.get(params.$sermonId as string) ?? null;
    }),
    getAllAsync: jest.fn(async (sql: string) => {
      const all = Array.from(rows.values());
      if (sql.includes('detail_json IS NULL')) {
        return all.filter((r) => r.state === 'ready' && !r.detail_json);
      }
      if (sql.includes("state IN ('queued', 'downloading')")) {
        return all.filter((r) => r.state === 'queued' || r.state === 'downloading').sort((a, b) => a.created_at - b.created_at);
      }
      return all.sort((a, b) => b.updated_at - a.updated_at);
    }),
    __rows: rows,
  };
}

jest.mock('expo-sqlite', () => ({
  __esModule: true,
  openDatabaseAsync: jest.fn(),
}));

beforeEach(() => {
  __resetConnectionForTests();
  jest.clearAllMocks();
  const fake = makeFakeDatabase();
  (SQLite.openDatabaseAsync as jest.Mock).mockResolvedValue(fake);
});

describe('downloads db', () => {
  it('upsertQueued creates a fresh row in the queued state with zero progress', async () => {
    await upsertQueued('sermon-1', 'A Great Sermon', 'audio');
    const record = await getDownload('sermon-1');
    expect(record).toMatchObject({
      sermonId: 'sermon-1',
      title: 'A Great Sermon',
      state: 'queued',
      progress: 0,
      bytesTotal: null,
      failureReason: null,
    });
  });

  it('getDownload returns null for a sermon with no row', async () => {
    await expect(getDownload('nope')).resolves.toBeNull();
  });

  it('the full lifecycle — queued -> downloading -> progress -> ready — reads back correctly', async () => {
    await upsertQueued('sermon-1', 'Title', 'audio');
    await markDownloading('sermon-1');
    expect((await getDownload('sermon-1'))?.state).toBe('downloading');

    await updateProgress('sermon-1', 0.42);
    expect((await getDownload('sermon-1'))?.progress).toBeCloseTo(0.42);

    await markReady('sermon-1', { bytesTotal: 12_345, keyIdHex: 'aabbccdd' });
    const ready = await getDownload('sermon-1');
    expect(ready).toMatchObject({
      state: 'ready',
      progress: 1,
      bytesTotal: 12_345,
      keyIdHex: 'aabbccdd',
      failureReason: null,
    });
  });

  it('updateProgress clamps out-of-range values into [0, 1]', async () => {
    await upsertQueued('sermon-1', 'Title', 'audio');
    await updateProgress('sermon-1', 1.5);
    expect((await getDownload('sermon-1'))?.progress).toBe(1);
    await updateProgress('sermon-1', -0.5);
    expect((await getDownload('sermon-1'))?.progress).toBe(0);
  });

  it('markFailed records a distinguishable reason and message, readable back by the UI', async () => {
    await upsertQueued('sermon-1', 'Title', 'audio');
    await markDownloading('sermon-1');
    await markFailed('sermon-1', 'network', 'Could not reach the server. Check your connection.');

    const record = await getDownload('sermon-1');
    expect(record).toMatchObject({
      state: 'failed',
      failureReason: 'network',
      failureMessage: 'Could not reach the server. Check your connection.',
    });
  });

  it('retrying (upsertQueued again) clears a prior failure back to a clean queued state', async () => {
    await upsertQueued('sermon-1', 'Title', 'audio');
    await markFailed('sermon-1', 'corrupt', 'The downloaded file was damaged.');
    expect((await getDownload('sermon-1'))?.state).toBe('failed');

    await upsertQueued('sermon-1', 'Title', 'audio');
    const record = await getDownload('sermon-1');
    expect(record).toMatchObject({ state: 'queued', progress: 0, failureReason: null, failureMessage: null });
  });

  it('deleteDownload removes the row entirely', async () => {
    await upsertQueued('sermon-1', 'Title', 'audio');
    await deleteDownload('sermon-1');
    await expect(getDownload('sermon-1')).resolves.toBeNull();
  });

  it('listDownloads returns every row, most-recently-updated first', async () => {
    await upsertQueued('sermon-a', 'A', 'audio');
    await upsertQueued('sermon-b', 'B', 'audio');
    await markDownloading('sermon-a'); // bumps sermon-a's updated_at last

    const list = await listDownloads();
    expect(list.map((r) => r.sermonId)).toEqual(['sermon-a', 'sermon-b']);
  });

  it('listActiveDownloads returns only queued/downloading rows — the startup-sweep target set', async () => {
    await upsertQueued('sermon-a', 'A', 'audio');
    await upsertQueued('sermon-b', 'B', 'audio');
    await markDownloading('sermon-b');
    await upsertQueued('sermon-c', 'C', 'audio');
    await markReady('sermon-c', { bytesTotal: 1, keyIdHex: '00' });

    const active = await listActiveDownloads();
    expect(active.map((r) => r.sermonId).sort()).toEqual(['sermon-a', 'sermon-b']);
  });

  it('setThumbnailPath writes the column, and getDownload reflects it', async () => {
    await upsertQueued('sermon-1', 'Title', 'audio');
    const updated = await setThumbnailPath('sermon-1', '/downloads/sermon-1.thumb');
    expect(updated).toBe(true);
    expect((await getDownload('sermon-1'))?.thumbnailPath).toBe('/downloads/sermon-1.thumb');
  });

  it('setThumbnailPath returns false when the row no longer exists — the orphan-file race downloadManager.ts relies on this to detect', async () => {
    const updated = await setThumbnailPath('sermon-never-existed', '/downloads/sermon-never-existed.thumb');
    expect(updated).toBe(false);
  });

  it('setThumbnailPath(null) clears a previously-set path (the fetch-failed cleanup case)', async () => {
    await upsertQueued('sermon-1', 'Title', 'audio');
    await setThumbnailPath('sermon-1', '/downloads/sermon-1.thumb');
    await setThumbnailPath('sermon-1', null);
    expect((await getDownload('sermon-1'))?.thumbnailPath).toBeNull();
  });

  // Session 2026-10-15 fix: `thumbnail_path` is added the exact same way `media_type`/
  // `thumbnail_url`/`category` were before it — a `PRAGMA table_info` check guarding an
  // `ALTER TABLE ADD COLUMN`, since `CREATE TABLE IF NOT EXISTS` is a no-op against an
  // install that already has the `downloads` table. This drives `getDb()` against a fake
  // whose `PRAGMA table_info(downloads)` response simulates exactly that — an install that
  // predates this fix (has `media_type`/`thumbnail_url`/`category` from the prior
  // migrations, but not `thumbnail_path`) — and asserts the new column's `ALTER TABLE`
  // fires while the already-present columns' migrations don't re-fire.
  it('adds thumbnail_path via ALTER TABLE on an install that predates it, leaving already-migrated columns alone', async () => {
    const execCalls: string[] = [];
    const preExistingColumns = [
      'sermon_id',
      'title',
      'state',
      'progress',
      'bytes_total',
      'failure_reason',
      'failure_message',
      'key_id_hex',
      'created_at',
      'updated_at',
      'media_type',
      'thumbnail_url',
      'category',
      // thumbnail_path intentionally omitted — this is the pre-fix schema shape.
    ];
    const preExistingSchemaDb = {
      execAsync: jest.fn(async (sql: string) => {
        execCalls.push(sql);
      }),
      runAsync: jest.fn(async () => ({ changes: 0, lastInsertRowId: 0 })),
      getFirstAsync: jest.fn(async () => null),
      getAllAsync: jest.fn(async (sql: string) => {
        if (sql.includes('PRAGMA table_info')) {
          return preExistingColumns.map((name) => ({ name }));
        }
        return [];
      }),
    };
    (SQLite.openDatabaseAsync as jest.Mock).mockResolvedValue(preExistingSchemaDb);
    __resetConnectionForTests();

    await getDownload('irrelevant'); // forces getDb() to run, including the migration block

    expect(execCalls.some((sql) => sql.includes('ADD COLUMN thumbnail_path'))).toBe(true);
    expect(execCalls.some((sql) => sql.includes('ADD COLUMN media_type'))).toBe(false);
    expect(execCalls.some((sql) => sql.includes('ADD COLUMN thumbnail_url'))).toBe(false);
    expect(execCalls.some((sql) => sql.includes('ADD COLUMN category'))).toBe(false);
  });
});


describe('db — sermon detail snapshot (offline playback)', () => {
  it('saves and reads back a snapshot, and lists ready rows still missing one', async () => {
    await upsertQueued('sermon-1', 'One', 'audio');
    await markReady('sermon-1', { bytesTotal: 1, keyIdHex: null });
    await upsertQueued('sermon-2', 'Two', 'audio');
    await markReady('sermon-2', { bytesTotal: 1, keyIdHex: null });
    await upsertQueued('sermon-3', 'Three', 'audio');

    expect(await setDetailSnapshot('sermon-1', '{"id":"sermon-1"}')).toBe(true);

    expect(await getDetailSnapshot('sermon-1')).toBe('{"id":"sermon-1"}');
    expect(await getDetailSnapshot('sermon-2')).toBeNull();
    expect(await listReadyMissingDetail()).toEqual(['sermon-2']);
  });

  it('reports false when the row was deleted before the snapshot landed', async () => {
    expect(await setDetailSnapshot('gone', '{}')).toBe(false);
  });
});
