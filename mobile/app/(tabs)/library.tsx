import React, { useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText, PlatformIcon, SectionError, ShelfSkeleton } from '../../components';
import { ContinueWatchingCard } from '../../components/sermon/ContinueWatchingCard';
import { colors } from '../../theme/colors';
import { radius } from '../../theme/radius';
import { spacing } from '../../theme/spacing';
import { fontFamily } from '../../theme/typography';
import { userMessageFor } from '../../lib/api/errors';
import { useContinueWatching } from '../../lib/query/hooks/useContinueWatching';
import { useDownloads } from '../../lib/downloads/useDownloads';
import { useDeletePlaylist, usePlaylists } from '../../lib/query/hooks/usePlaylists';
import { DownloadRow } from './_downloads/DownloadRow';
import { DownloadGridTile } from './_library/DownloadGridTile';
import { GRID_COLUMNS, GRID_GAP, GRID_PADDING } from './_library/libraryLayout';
import { LibraryFilterPills, type LibraryFilter } from './_library/LibraryFilterPills';
import { LibraryHeader } from './_library/LibraryHeader';
import { LibrarySortRow, type LibraryLayout } from './_library/LibrarySortRow';
import { LibrarySortSheet } from './_library/LibrarySortSheet';
import { PlaylistCard } from './_library/PlaylistCard';
import { PlaylistGridTile } from './_library/PlaylistGridTile';
import { libraryItemTitle, sortLibraryItems, type LibraryItem, type LibrarySortMode } from './_library/librarySort';

/**
 * Library (Isaac's ask, session 2026-10-10: "a tab called Library ... to
 * create playlists and also show downloaded videos", Spotify's own "Your
 * Library" flow as the reference; redesigned twice the same session — first
 * to add the header/pills/sort row, then again to drop the "Playlists"/
 * "Downloads" section headers and genuinely interleave the two into one
 * sorted list/grid, since "items should look similar" only makes sense once
 * nothing visually separates them any more). Replaces the former
 * `downloads` tab destination one-for-one in the nav (`routes.ts`).
 *
 * Playlists and downloads are combined into one `LibraryItem[]` (see
 * `librarySort.ts`) before filtering/searching/sorting, so the exact same
 * code path renders "both" / "playlists only" / "downloads only" — the
 * filter pills just narrow which `kind`s are in the array, nothing else
 * about the rendering changes.
 *
 * List rows are deliberately flat, not boxed in a bordered `Card` (an
 * earlier pass that read as a generic bordered settings list once the two
 * surface tones involved — `surface.app`/`surface.raised` — turned out too
 * close in value to actually look "elevated"; Isaac's own call, session
 * 2026-10-10: "looks standard/basic"). Generous row spacing carries the
 * visual rhythm instead, same as every reference list app in this space
 * does it. The search field borrows `AndroidSearchEntry`'s own established
 * pill shape (`surface.raised`, `radius.pill`, icon inside, no border)
 * rather than a boxed `TextInput`, for the same reason — matching this
 * app's own visual language elsewhere beats a bespoke one-off. A playlist
 * and a download still read as the same kind of object because they share
 * identical sizing/typography (`libraryLayout.ts`'s `LIST_THUMBNAIL_SIZE`);
 * the one deliberate difference is the sage-green checkmark `DownloadRow`
 * shows before its category text once ready, the sole visual cue that a row
 * happens to be a download.
 *
 * A "Continue watching" shelf sits above the search/filter/sort controls
 * (Isaac's ask, session 2026-10-10, inspired by YouTube's own profile-page
 * "History" row). It's labeled "Continue watching", not "History": the only
 * display-ready data this app has for a row like this is `/me/continue-
 * watching` (in-progress sermons, title/thumbnail/progress included) — the
 * same call and the same `ContinueWatchingCard` Home's own shelf already
 * uses, promoted to `components/` once Library became its second consumer.
 * There's no full watch-history endpoint with display data behind it
 * (`/me/history` returns only `sermon_id` + progress numbers, no title or
 * thumbnail), so labeling this "History" would overstate what it actually
 * shows. Omitted entirely when it resolves empty, same as Home's own copy
 * of this shelf — no empty-state card for a shelf that has nothing to show.
 */
export default function LibraryScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const playlists = usePlaylists();
  const downloads = useDownloads();
  const continueWatching = useContinueWatching();
  const deletePlaylist = useDeletePlaylist();
  const continueWatchingItems = continueWatching.data ?? [];

  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<LibraryFilter>(null);
  const [layout, setLayout] = useState<LibraryLayout>('list');
  const [sortMode, setSortMode] = useState<LibrarySortMode>('recents');
  const [sortSheetOpen, setSortSheetOpen] = useState(false);
  const [searchActive, setSearchActive] = useState(false);
  const [query, setQuery] = useState('');

  const onRefresh = async () => {
    setRefreshing(true);
    await playlists.refetch();
    setRefreshing(false);
  };

  const closeSearch = () => {
    setSearchActive(false);
    setQuery('');
  };

  const showPlaylists = filter !== 'downloaded';
  const showDownloads = filter !== 'playlists';
  const isLoading = (showPlaylists && playlists.isLoading) || (showDownloads && downloads.isLoading);

  const allItems: LibraryItem[] = [
    ...(showPlaylists ? (playlists.data ?? []) : []).map(
      (playlist): LibraryItem => ({ kind: 'playlist', key: `playlist-${playlist.id}`, playlist }),
    ),
    ...(showDownloads ? downloads.downloads : []).map(
      (download): LibraryItem => ({ kind: 'download', key: `download-${download.sermonId}`, download }),
    ),
  ];

  const normalizedQuery = query.trim().toLowerCase();
  const searched = normalizedQuery
    ? allItems.filter((item) => libraryItemTitle(item).toLowerCase().includes(normalizedQuery))
    : allItems;
  const items = sortLibraryItems(searched, sortMode);

  const emptyMessage = normalizedQuery
    ? 'Nothing matches your search.'
    : filter === 'playlists'
      ? 'Create a playlist to collect your favorite sermons and series episodes.'
      : filter === 'downloaded'
        ? 'Download a sermon from its detail page to watch or listen offline.'
        : 'Your library is empty. Create a playlist or download a sermon to get started.';

  const tileWidth = (windowWidth - GRID_PADDING * 2 - GRID_GAP * (GRID_COLUMNS - 1)) / GRID_COLUMNS;

  const goToPlayer = (sermonId: string) => router.push({ pathname: '/player/[id]', params: { id: sermonId } });
  const goToPlaylist = (playlistId: string) => router.push({ pathname: '/playlist/[id]', params: { id: playlistId } });
  const goToSermon = (sermonId: string) => router.push({ pathname: '/sermon/[id]', params: { id: sermonId } });

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: Math.max(insets.top, spacing.lg) }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor={colors.accent.gold} />}
        showsVerticalScrollIndicator={false}
      >
        <LibraryHeader
          searchActive={searchActive}
          onToggleSearch={() => (searchActive ? closeSearch() : setSearchActive(true))}
          onCreatePlaylist={() => router.push('/playlist/create')}
        />

        {continueWatching.isLoading ? (
          <View style={styles.section}>
            <AppText variant="ui.label" tone="secondary" style={styles.sectionLabel}>
              continue watching
            </AppText>
            <ShelfSkeleton loadingLabel="Loading continue watching" />
          </View>
        ) : continueWatching.isError ? (
          <View style={styles.section}>
            <AppText variant="ui.label" tone="secondary" style={styles.sectionLabel}>
              continue watching
            </AppText>
            <SectionError message={userMessageFor(continueWatching.error)} onRetry={() => continueWatching.refetch()} />
          </View>
        ) : continueWatchingItems.length > 0 ? (
          <View style={styles.section}>
            <AppText variant="ui.label" tone="secondary" style={styles.sectionLabel}>
              continue watching
            </AppText>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.shelf}>
              {continueWatchingItems.map((item) => (
                <ContinueWatchingCard key={item.id} item={item} onPress={() => goToSermon(item.id)} />
              ))}
            </ScrollView>
          </View>
        ) : null}

        <View style={styles.controls}>
          {searchActive ? (
            <View style={styles.searchBar}>
              <PlatformIcon name="search" size={16} color={colors.text.tertiary} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="Search your library"
                placeholderTextColor={colors.text.tertiary}
                autoFocus
                style={styles.searchInput}
                accessibilityLabel="Search your library"
              />
            </View>
          ) : null}

          <LibraryFilterPills value={filter} onChange={setFilter} />

          <LibrarySortRow
            sortMode={sortMode}
            onSortPress={() => setSortSheetOpen(true)}
            layout={layout}
            onToggleLayout={() => setLayout((current) => (current === 'list' ? 'grid' : 'list'))}
          />
        </View>

        {isLoading ? (
          <View style={styles.inlineLoading} accessibilityRole="progressbar" accessibilityLabel="Loading your library">
            <ActivityIndicator color={colors.accent.gold} />
          </View>
        ) : items.length === 0 ? (
          <AppText variant="ui.body" tone="secondary" style={styles.emptyText}>
            {emptyMessage}
          </AppText>
        ) : layout === 'list' ? (
          <View style={styles.list}>
            {items.map((item) =>
              item.kind === 'playlist' ? (
                <PlaylistCard
                  key={item.key}
                  playlist={item.playlist}
                  onPress={() => goToPlaylist(item.playlist.id)}
                  onDelete={() => deletePlaylist.mutate(item.playlist.id)}
                />
              ) : (
                <DownloadRow
                  key={item.key}
                  download={item.download}
                  onPlay={goToPlayer}
                  onRetry={(sermonId) => void downloads.retry(sermonId)}
                  onDelete={(sermonId) => void downloads.remove(sermonId)}
                />
              ),
            )}
          </View>
        ) : (
          <View style={styles.grid}>
            {items.map((item) =>
              item.kind === 'playlist' ? (
                <PlaylistGridTile
                  key={item.key}
                  playlist={item.playlist}
                  width={tileWidth}
                  onPress={() => goToPlaylist(item.playlist.id)}
                  onDelete={() => deletePlaylist.mutate(item.playlist.id)}
                />
              ) : (
                <DownloadGridTile
                  key={item.key}
                  download={item.download}
                  width={tileWidth}
                  onPlay={goToPlayer}
                  onRetry={(sermonId) => void downloads.retry(sermonId)}
                  onDelete={(sermonId) => void downloads.remove(sermonId)}
                />
              ),
            )}
          </View>
        )}
      </ScrollView>

      <LibrarySortSheet visible={sortSheetOpen} onClose={() => setSortSheetOpen(false)} value={sortMode} onChange={setSortMode} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.surface.app,
  },
  content: {
    flexGrow: 1,
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xxl * 2,
    gap: spacing.xl,
  },
  section: {
    gap: spacing.md,
  },
  sectionLabel: {
    textTransform: 'uppercase',
  },
  shelf: {
    gap: spacing.md,
  },
  controls: {
    gap: spacing.lg,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface.raised,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  searchInput: {
    flex: 1,
    fontFamily: fontFamily.ui,
    fontSize: 15,
    color: colors.text.primary,
    padding: 0,
  },
  inlineLoading: {
    paddingVertical: spacing.xl,
    alignItems: 'center',
  },
  emptyText: {
    paddingVertical: spacing.lg,
  },
  list: {
    gap: spacing.lg,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: GRID_GAP,
  },
});
