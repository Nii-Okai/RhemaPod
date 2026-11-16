/**
 * `../manifest.ts` against an in-memory fake of expo-sqlite's statement API, keyed off the
 * SQL shapes the module issues (same approach and same limit as
 * `lib/downloads/__tests__/db.test.ts`): real SQLite does not run under Jest, so this does
 * NOT prove the real engine accepts the DDL/SQL or the db-file lifecycle. That proof is the
 * on-device check (D16 / T.4).
 */
import * as SQLite from 'expo-sqlite';
import * as fs from 'fs';
import * as path from 'path';
import * as manifest from '../manifest';
import { expectNoSecrets } from './helpers';

interface Row {
  media_ref_id: string;
  sermon_id: string;
  file_name: string;
  size_bytes: number;
  last_accessed_at: number;
  created_at: number;
}

const ddl: string[] = [];
let rows: Map<string, Row>;

function makeFakeDatabase() {
  return {
    execAsync: jest.fn(async (sql: string) => {
      ddl.push(sql);
    }),
    closeAsync: jest.fn(async () => undefined),
    runAsync: jest.fn(async (sql: string, p: Record<string, unknown>) => {
      if (sql.includes('INSERT INTO media_cache')) {
        const existing = rows.get(p.$id as string);
        void existing;
        rows.set(p.$id as string, {
          media_ref_id: p.$id as string,
          sermon_id: p.$sermonId as string,
          file_name: p.$fileName as string,
          size_bytes: p.$sizeBytes as number,
          last_accessed_at: p.$lastAccessedAt as number,
          created_at: p.$createdAt as number,
        });
      } else if (sql.includes('UPDATE media_cache SET last_accessed_at')) {
        const r = rows.get(p.$id as string);
        if (r) r.last_accessed_at = p.$now as number;
      } else if (sql.includes('DELETE FROM media_cache WHERE media_ref_id')) {
        rows.delete(p.$id as string);
      } else if (sql.includes('DELETE FROM media_cache WHERE sermon_id')) {
        for (const [k, r] of rows) if (r.sermon_id === p.$sermonId) rows.delete(k);
      } else {
        throw new Error(`unexpected runAsync SQL: ${sql}`);
      }
    }),
    getFirstAsync: jest.fn(async (sql: string, p?: Record<string, unknown>) => {
      if (sql.includes('SUM(size_bytes)')) {
        let total = 0;
        for (const r of rows.values()) total += r.size_bytes;
        return { total };
      }
      if (sql.includes('WHERE media_ref_id')) return rows.get(p!.$id as string) ?? null;
      throw new Error(`unexpected getFirstAsync SQL: ${sql}`);
    }),
    getAllAsync: jest.fn(async (sql: string, p?: Record<string, unknown>) => {
      if (sql.includes('WHERE sermon_id')) return [...rows.values()].filter((r) => r.sermon_id === p!.$sermonId);
      if (sql.includes('ORDER BY last_accessed_at ASC, created_at ASC, media_ref_id ASC')) {
        return [...rows.values()].sort(
          (a, b) =>
            a.last_accessed_at - b.last_accessed_at ||
            a.created_at - b.created_at ||
            a.media_ref_id.localeCompare(b.media_ref_id),
        );
      }
      throw new Error(`unexpected getAllAsync SQL: ${sql}`);
    }),
  };
}

jest.mock('expo-sqlite', () => ({ __esModule: true, openDatabaseAsync: jest.fn(), deleteDatabaseAsync: jest.fn() }));

const mockedOpen = SQLite.openDatabaseAsync as unknown as jest.Mock;
const mockedDeleteDatabase = SQLite.deleteDatabaseAsync as unknown as jest.Mock;
let fake: ReturnType<typeof makeFakeDatabase>;

const entry = (over: Partial<manifest.ManifestEntry> = {}): manifest.ManifestEntry => ({
  mediaRefId: 'ref-1',
  sermonId: 'sermon-1',
  fileName: 'ref-1.mp3',
  sizeBytes: 100,
  lastAccessedAt: 1000,
  createdAt: 500,
  ...over,
});

beforeEach(async () => {
  await manifest.close();
  rows = new Map();
  ddl.length = 0;
  fake = makeFakeDatabase();
  mockedOpen.mockReset();
  mockedOpen.mockResolvedValue(fake);
  mockedDeleteDatabase.mockReset();
  // Simulates what a real file delete does — the backing data is gone, same as the real
  // engine would leave nothing for the next `openDatabaseAsync` to find.
  mockedDeleteDatabase.mockImplementation(async () => {
    rows.clear();
  });
});

describe('manifest', () => {
  it('insert then get round-trips all fields; get of a missing key is null', async () => {
    await manifest.insert(entry());
    expect(await manifest.get('ref-1')).toEqual(entry());
    expect(await manifest.get('nope')).toBeNull();
  });

  it('inserting a duplicate media_ref_id updates the row with no duplicate', async () => {
    await manifest.insert(entry());
    await manifest.insert(entry({ sizeBytes: 250, lastAccessedAt: 2000 }));
    expect(rows.size).toBe(1);
    expect(await manifest.get('ref-1')).toEqual(entry({ sizeBytes: 250, lastAccessedAt: 2000 }));
    expect(fake.runAsync.mock.calls[1][0]).toContain('ON CONFLICT(media_ref_id)');
  });

  it('touch updates last_accessed_at only', async () => {
    await manifest.insert(entry());
    await manifest.touch('ref-1', 9999);
    expect(await manifest.get('ref-1')).toEqual(entry({ lastAccessedAt: 9999 }));
  });

  it('deleteByKey removes one row; deleteBySermon removes and returns all rows of that sermon', async () => {
    await manifest.insert(entry({ mediaRefId: 'a', fileName: 'a.mp3' }));
    await manifest.insert(entry({ mediaRefId: 'b', fileName: 'b.mp4' }));
    await manifest.insert(entry({ mediaRefId: 'c', sermonId: 'sermon-2', fileName: 'c.mp3' }));
    await manifest.deleteByKey('a');
    expect(await manifest.get('a')).toBeNull();
    const removed = await manifest.deleteBySermon('sermon-1');
    expect(removed.map((e) => e.mediaRefId)).toEqual(['b']);
    expect(await manifest.get('b')).toBeNull();
    expect(await manifest.get('c')).not.toBeNull();
    expect(await manifest.deleteBySermon('sermon-1')).toEqual([]);
  });

  it('deleteBySermon removes several rows for one sermon', async () => {
    await manifest.insert(entry({ mediaRefId: 'a' }));
    await manifest.insert(entry({ mediaRefId: 'b' }));
    expect((await manifest.deleteBySermon('sermon-1')).map((e) => e.mediaRefId).sort()).toEqual(['a', 'b']);
    expect(rows.size).toBe(0);
  });

  it('listByLru orders by last_accessed_at ascending with a deterministic tie-break', async () => {
    await manifest.insert(entry({ mediaRefId: 'z', lastAccessedAt: 10, createdAt: 1 }));
    await manifest.insert(entry({ mediaRefId: 'b', lastAccessedAt: 50, createdAt: 2 }));
    await manifest.insert(entry({ mediaRefId: 'a', lastAccessedAt: 50, createdAt: 2 }));
    await manifest.insert(entry({ mediaRefId: 'c', lastAccessedAt: 50, createdAt: 1 }));
    await manifest.insert(entry({ mediaRefId: 'm', lastAccessedAt: 5, createdAt: 9 }));
    expect((await manifest.listByLru()).map((e) => e.mediaRefId)).toEqual(['m', 'z', 'c', 'a', 'b']);
  });

  it('totalBytes sums size_bytes, and is 0 when empty', async () => {
    expect(await manifest.totalBytes()).toBe(0);
    await manifest.insert(entry({ mediaRefId: 'a', sizeBytes: 100 }));
    await manifest.insert(entry({ mediaRefId: 'b', sizeBytes: 23 }));
    expect(await manifest.totalBytes()).toBe(123);
  });

  it('close then reopen works and reuses one connection between closes', async () => {
    await manifest.insert(entry());
    await manifest.get('ref-1');
    expect(mockedOpen).toHaveBeenCalledTimes(1);
    await manifest.close();
    expect(fake.closeAsync).toHaveBeenCalledTimes(1);
    expect(await manifest.get('ref-1')).toEqual(entry());
    expect(mockedOpen).toHaveBeenCalledTimes(2);
  });

  it('close with no open connection is a no-op', async () => {
    await expect(manifest.close()).resolves.toBeUndefined();
    expect(mockedOpen).not.toHaveBeenCalled();
  });

  it('deleteDatabaseFile closes any open connection first, then deletes the db file', async () => {
    await manifest.insert(entry()); // opens the connection
    await manifest.deleteDatabaseFile();
    expect(fake.closeAsync).toHaveBeenCalledTimes(1);
    expect(mockedDeleteDatabase).toHaveBeenCalledTimes(1);
    // The next operation after a delete recreates the file fresh.
    expect(await manifest.get('ref-1')).toBeNull();
    expect(mockedOpen).toHaveBeenCalledTimes(2);
  });

  it('deleteDatabaseFile with no open connection still deletes the file', async () => {
    await manifest.deleteDatabaseFile();
    expect(mockedOpen).not.toHaveBeenCalled();
    expect(mockedDeleteDatabase).toHaveBeenCalledTimes(1);
  });

  it('a failed open is retried by the next call rather than cached', async () => {
    mockedOpen.mockReset();
    mockedOpen.mockRejectedValueOnce(new Error('disk full')).mockResolvedValue(fake);
    await expect(manifest.get('ref-1')).rejects.toThrow('disk full');
    await expect(manifest.get('ref-1')).resolves.toBeNull();
  });

  it('schema has no column whose name contains url, token or query', async () => {
    await manifest.get('x');
    const create = ddl.join('\n').match(/CREATE TABLE IF NOT EXISTS media_cache \(([\s\S]*?)\);/);
    expect(create).not.toBeNull();
    const columns = create![1]
      .split('\n')
      .map((l) => l.trim().split(/\s+/)[0])
      .filter(Boolean);
    expect(columns).toEqual([
      'media_ref_id',
      'sermon_id',
      'file_name',
      'size_bytes',
      'last_accessed_at',
      'created_at',
    ]);
    for (const c of columns) expect(c).not.toMatch(/url|token|query/i);
  });

  it('opens only rpa-media-cache.db and never references the downloads database', async () => {
    await manifest.insert(entry());
    await manifest.get('ref-1');
    expect(mockedOpen.mock.calls.map((c) => c[0])).toEqual(['rpa-media-cache.db']);
    const source = fs.readFileSync(path.join(__dirname, '..', 'manifest.ts'), 'utf8');
    expect(source).not.toMatch(/rpa-downloads|rhemapod-downloads|downloads\/db/);
  });

  it('keeps URL/token material out of rows, db arguments and console output', async () => {
    const logs = [jest.spyOn(console, 'info'), jest.spyOn(console, 'log'), jest.spyOn(console, 'warn')];
    await manifest.insert(entry());
    await manifest.touch('ref-1', 1);
    const everyArg = fake.runAsync.mock.calls.map((c) => JSON.stringify(c)).concat(ddl);
    expectNoSecrets([...rows.values()], everyArg, logs);
    logs.forEach((l) => l.mockRestore());
  });
});
