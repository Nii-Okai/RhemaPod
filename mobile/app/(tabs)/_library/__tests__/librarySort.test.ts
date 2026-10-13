import { sortLibraryItems, type LibraryItem } from '../librarySort';
import type { DownloadRecord } from '../../../../lib/downloads/types';
import type { PlaylistPublic } from '../../../../lib/query/hooks/usePlaylists';

function playlistItem(overrides: Partial<PlaylistPublic> = {}): LibraryItem {
  const playlist: PlaylistPublic = {
    id: 'p1',
    name: 'Morning Dew',
    description: null,
    is_public: true,
    cover_url: null,
    owner_name: 'Nii Okai',
    item_count: 0,
    total_duration_seconds: 0,
    created_at: '2026-10-10T00:00:00Z',
    updated_at: null,
    ...overrides,
  };
  return { kind: 'playlist', key: `playlist-${playlist.id}`, playlist };
}

function downloadItem(overrides: Partial<DownloadRecord> = {}): LibraryItem {
  const download: DownloadRecord = {
    sermonId: 's1',
    title: 'Anchored',
    thumbnailUrl: null,
    category: null,
    mediaType: 'audio',
    state: 'ready',
    progress: 1,
    bytesTotal: 1000,
    failureReason: null,
    failureMessage: null,
    keyIdHex: null,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
  return { kind: 'download', key: `download-${download.sermonId}`, download };
}

function keysOf(items: LibraryItem[]): string[] {
  return items.map((item) => item.key);
}

describe('sortLibraryItems — alphabetical', () => {
  it('interleaves playlists and downloads by name/title, not grouped by kind', () => {
    const items = [
      playlistItem({ id: 'z', name: 'Zebra' }),
      downloadItem({ sermonId: 'b', title: 'Banana' }),
      playlistItem({ id: 'a', name: 'Apple' }),
    ];
    expect(keysOf(sortLibraryItems(items, 'alphabetical'))).toEqual(['playlist-a', 'download-b', 'playlist-z']);
  });
});

describe('sortLibraryItems — creator', () => {
  it('sorts playlists by owner_name; every download sorts to the same empty key', () => {
    const items = [
      playlistItem({ id: 'z', owner_name: 'Zed' }),
      downloadItem({ sermonId: 'd1' }),
      playlistItem({ id: 'a', owner_name: 'Ada' }),
    ];
    // Empty-string downloads sort before any named creator.
    expect(keysOf(sortLibraryItems(items, 'creator'))).toEqual(['download-d1', 'playlist-a', 'playlist-z']);
  });
});

describe('sortLibraryItems — recently_added', () => {
  it('compares a playlist\'s created_at against a download\'s createdAt directly', () => {
    const items = [
      playlistItem({ id: 'old', created_at: '2026-01-01T00:00:00Z' }),
      downloadItem({ sermonId: 'mid', createdAt: new Date('2026-03-01T00:00:00Z').getTime() }),
      playlistItem({ id: 'new', created_at: '2026-06-01T00:00:00Z' }),
    ];
    expect(keysOf(sortLibraryItems(items, 'recently_added'))).toEqual(['playlist-new', 'download-mid', 'playlist-old']);
  });
});

describe('sortLibraryItems — recents', () => {
  it('uses created_at for a playlist but updatedAt (last activity) for a download', () => {
    const items = [
      playlistItem({ id: 'p', created_at: '2026-01-01T00:00:00Z' }),
      downloadItem({ sermonId: 'd', createdAt: 0, updatedAt: new Date('2026-06-01T00:00:00Z').getTime() }),
    ];
    // The download's createdAt is older than the playlist's, but its updatedAt (recent
    // progress activity) is newer — recents must read updatedAt, not createdAt.
    expect(keysOf(sortLibraryItems(items, 'recents'))).toEqual(['download-d', 'playlist-p']);
  });

  it('does not mutate the input array', () => {
    const items = [playlistItem({ id: 'a' }), downloadItem({ sermonId: 'b' })];
    const copy = [...items];
    sortLibraryItems(items, 'alphabetical');
    expect(items).toEqual(copy);
  });
});
