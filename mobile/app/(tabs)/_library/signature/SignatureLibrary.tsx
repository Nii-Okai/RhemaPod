import React, { useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, TextInput, useWindowDimensions, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText, IconButton, PlatformIcon, SectionError, ShelfSkeleton, StaggerItem } from '../../../../components';
import { createThemedStyles, useTheme } from '../../../../theme/ThemeContext';
import { radius } from '../../../../theme/radius';
import { spacing } from '../../../../theme/spacing';
import { fontFamily } from '../../../../theme/typography';
import { userMessageFor } from '../../../../lib/api/errors';
import { useDownloads } from '../../../../lib/downloads/useDownloads';
import { useContinueWatching } from '../../../../lib/query/hooks/useContinueWatching';
import { useDeletePlaylist, usePlaylists } from '../../../../lib/query/hooks/usePlaylists';
import { Flame } from '../../_home/signature/Flame';
import { LEAF } from '../../_home/signature/leaf';
import { ResumeCard } from '../../_home/signature/shelfCards';
import type { LibraryFilter } from '../LibraryFilterPills';
import type { LibraryLayout } from '../LibrarySortRow';
import { LibrarySortSheet } from '../LibrarySortSheet';
import { libraryItemTitle, sortLibraryItems, SORT_MODE_LABEL, type LibraryItem, type LibrarySortMode } from '../librarySort';
import { DownloadGridTile, DownloadListRow, PlaylistGridTile, PlaylistListRow } from './LibraryItems';
import { SegmentedControl } from './SegmentedControl';

const GUTTER = spacing.lg;
const GRID_COLUMNS = 2;
const GRID_GAP = spacing.md;

type FilterKey = 'all' | 'playlists' | 'downloaded';

const toFilter = (key: FilterKey): LibraryFilter => (key === 'all' ? null : key);

function countLabel(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/**
 * Library, Signature redesign (Nii's ask, 2026-10-22: "feel free to redesign library
 * screens"), behind `SIGNATURE_LIBRARY_ENABLED`. Same data, sorting and actions as the
 * classic tab — playlists and downloads interleaved through `librarySort.ts`, client-side
 * search, the sort sheet, list/grid, long-press delete — restyled in the Signature
 * language: a Newsreader title with a mono tally, Home's "Pick up where you left off"
 * shelf, the You screen's segmented track for the filter (now with an explicit "All"
 * and per-filter counts), and leaf-cornered art with mono meta lines.
 */
export function SignatureLibraryScreen() {
  const { colors } = useTheme();
  const styles = useStyles();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const playlists = usePlaylists();
  const downloads = useDownloads();
  const continueWatching = useContinueWatching();
  const deletePlaylist = useDeletePlaylist();

  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<FilterKey>('all');
  const [layout, setLayout] = useState<LibraryLayout>('list');
  const [sortMode, setSortMode] = useState<LibrarySortMode>('recents');
  const [sortSheetOpen, setSortSheetOpen] = useState(false);
  const [searchActive, setSearchActive] = useState(false);
  const [query, setQuery] = useState('');

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([playlists.refetch(), continueWatching.refetch()]);
    setRefreshing(false);
  };

  const closeSearch = () => {
    setSearchActive(false);
    setQuery('');
  };

  const playlistList = playlists.data ?? [];
  const downloadList = downloads.downloads;
  const resumeItems = continueWatching.data ?? [];

  const narrowed = toFilter(filter);
  const showPlaylists = narrowed !== 'downloaded';
  const showDownloads = narrowed !== 'playlists';
  const isLoading = (showPlaylists && playlists.isLoading) || (showDownloads && downloads.isLoading);

  const allItems: LibraryItem[] = [
    ...(showPlaylists ? playlistList : []).map(
      (playlist): LibraryItem => ({ kind: 'playlist', key: `playlist-${playlist.id}`, playlist }),
    ),
    ...(showDownloads ? downloadList : []).map(
      (download): LibraryItem => ({ kind: 'download', key: `download-${download.sermonId}`, download }),
    ),
  ];
  const normalizedQuery = query.trim().toLowerCase();
  const searched = normalizedQuery
    ? allItems.filter((item) => libraryItemTitle(item).toLowerCase().includes(normalizedQuery))
    : allItems;
  const items = sortLibraryItems(searched, sortMode);

  const tally = [countLabel(playlistList.length, 'playlist', 'playlists'), countLabel(downloadList.length, 'download', 'downloads')]
    .join(' · ')
    .toUpperCase();

  const emptyMessage = normalizedQuery
    ? 'Nothing matches your search.'
    : filter === 'playlists'
      ? 'Collect your favourite sermons and series episodes in a playlist.'
      : filter === 'downloaded'
        ? 'Download a sermon from its page to watch or listen offline.'
        : 'Your library is empty. Start a playlist or download a sermon.';
  const offerCreate = !normalizedQuery && filter !== 'downloaded';

  const tileWidth = (windowWidth - GUTTER * 2 - GRID_GAP * (GRID_COLUMNS - 1)) / GRID_COLUMNS;

  const goToPlayer = (sermonId: string) => router.push({ pathname: '/player/[id]', params: { id: sermonId } });
  const goToPlaylist = (playlistId: string) => router.push({ pathname: '/playlist/[id]', params: { id: playlistId } });
  const goToSermon = (sermonId: string) => router.push({ pathname: '/sermon/[id]', params: { id: sermonId } });
  const createPlaylist = () => router.push('/playlist/create');

  const renderItem = (item: LibraryItem) => {
    if (layout === 'list') {
      return item.kind === 'playlist' ? (
        <PlaylistListRow
          playlist={item.playlist}
          onPress={() => goToPlaylist(item.playlist.id)}
          onDelete={() => deletePlaylist.mutate(item.playlist.id)}
        />
      ) : (
        <DownloadListRow
          download={item.download}
          onPlay={goToPlayer}
          onRetry={(sermonId) => void downloads.retry(sermonId)}
          onDelete={(sermonId) => void downloads.remove(sermonId)}
        />
      );
    }
    return item.kind === 'playlist' ? (
      <PlaylistGridTile
        playlist={item.playlist}
        width={tileWidth}
        onPress={() => goToPlaylist(item.playlist.id)}
        onDelete={() => deletePlaylist.mutate(item.playlist.id)}
      />
    ) : (
      <DownloadGridTile
        download={item.download}
        width={tileWidth}
        onPlay={goToPlayer}
        onRetry={(sermonId) => void downloads.retry(sermonId)}
        onDelete={(sermonId) => void downloads.remove(sermonId)}
      />
    );
  };

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: Math.max(insets.top, spacing.lg) }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void onRefresh()}
            tintColor={colors.accent.gold}
            colors={[colors.accent.gold]}
          />
        }
      >
        <View style={[styles.gutter, styles.header]}>
          <View style={styles.headerText}>
            <AppText variant="display.hero" accessibilityRole="header">
              Library
            </AppText>
            <AppText variant="mono.meta" tone="tertiary">
              {tally}
            </AppText>
          </View>
          <View style={styles.headerActions}>
            <IconButton
              icon={searchActive ? 'close' : 'search'}
              size={22}
              accessibilityLabel={searchActive ? 'Close search' : 'Search your library'}
              onPress={() => (searchActive ? closeSearch() : setSearchActive(true))}
            />
            <Pressable
              onPress={createPlaylist}
              accessibilityRole="button"
              accessibilityLabel="New playlist"
              style={({ pressed }) => [styles.newButton, pressed && styles.pressed]}
            >
              <PlatformIcon name="add" size={22} color={colors.primaryButton.text} />
            </Pressable>
          </View>
        </View>

        {continueWatching.isLoading || continueWatching.isError || resumeItems.length > 0 ? (
          <View style={styles.section}>
            <AppText variant="display.section" accessibilityRole="header" style={styles.gutter}>
              Pick up where you left off
            </AppText>
            {continueWatching.isLoading ? (
              <View style={styles.gutter}>
                <ShelfSkeleton loadingLabel="Loading continue watching" />
              </View>
            ) : continueWatching.isError ? (
              <View style={styles.gutter}>
                <SectionError message={userMessageFor(continueWatching.error)} onRetry={() => continueWatching.refetch()} />
              </View>
            ) : (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.shelf}>
                {resumeItems.map((item, index) => (
                  <StaggerItem key={item.id} index={index}>
                    <ResumeCard item={item} onPress={() => goToSermon(item.id)} />
                  </StaggerItem>
                ))}
              </ScrollView>
            )}
          </View>
        ) : null}

        <View style={[styles.gutter, styles.section]}>
          <AppText variant="display.section" accessibilityRole="header">
            Your collection
          </AppText>

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

          <SegmentedControl<FilterKey>
            accessibilityLabel="Show"
            value={filter}
            onChange={setFilter}
            segments={[
              { key: 'all', label: 'All' },
              { key: 'playlists', label: 'Playlists', meta: String(playlistList.length) },
              { key: 'downloaded', label: 'Downloaded', meta: String(downloadList.length) },
            ]}
          />

          <View style={styles.sortRow}>
            <Pressable
              onPress={() => setSortSheetOpen(true)}
              accessibilityRole="button"
              accessibilityLabel={`Sort by ${SORT_MODE_LABEL[sortMode]}`}
              hitSlop={spacing.sm}
              style={({ pressed }) => [styles.sortButton, pressed && styles.pressed]}
            >
              <PlatformIcon name="swap-vertical" size={15} color={colors.accent.goldText} />
              <AppText variant="mono.meta" tone="secondary">
                {SORT_MODE_LABEL[sortMode].toUpperCase()}
              </AppText>
            </Pressable>
            <View style={styles.layoutToggle} accessibilityRole="radiogroup" accessibilityLabel="Layout">
              {(['list', 'grid'] as const).map((option) => {
                const selected = option === layout;
                return (
                  <Pressable
                    key={option}
                    onPress={() => setLayout(option)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                    accessibilityLabel={option === 'list' ? 'List view' : 'Grid view'}
                    style={[styles.layoutOption, selected && styles.layoutOptionSelected]}
                  >
                    <PlatformIcon
                      name={option === 'list' ? 'list' : 'grid-outline'}
                      size={16}
                      color={selected ? colors.accent.goldText : colors.text.tertiary}
                    />
                  </Pressable>
                );
              })}
            </View>
          </View>

          {isLoading ? (
            <View style={styles.inlineLoading} accessibilityRole="progressbar" accessibilityLabel="Loading your library">
              <ActivityIndicator color={colors.accent.gold} />
            </View>
          ) : items.length === 0 ? (
            <View style={[styles.empty, LEAF]}>
              <Flame width={14} fill={colors.accent.gold} />
              <AppText variant="display.compact" tone="secondary">
                {emptyMessage}
              </AppText>
              {offerCreate ? (
                <Pressable
                  onPress={createPlaylist}
                  accessibilityRole="button"
                  style={({ pressed }) => [styles.emptyButton, pressed && styles.pressed]}
                >
                  <PlatformIcon name="add" size={16} color={colors.primaryButton.text} />
                  <AppText variant="ui.button" tone="inverse">
                    New playlist
                  </AppText>
                </Pressable>
              ) : null}
            </View>
          ) : layout === 'list' ? (
            <View>
              {items.map((item, index) => (
                <StaggerItem key={item.key} index={index}>
                  {renderItem(item)}
                </StaggerItem>
              ))}
            </View>
          ) : (
            <View style={styles.grid}>
              {items.map((item, index) => (
                <StaggerItem key={item.key} index={index}>
                  {renderItem(item)}
                </StaggerItem>
              ))}
            </View>
          )}
        </View>
      </ScrollView>

      <LibrarySortSheet visible={sortSheetOpen} onClose={() => setSortSheetOpen(false)} value={sortMode} onChange={setSortMode} />
    </View>
  );
}

const useStyles = createThemedStyles((colors) => ({
  screen: {
    flex: 1,
    backgroundColor: colors.surface.app,
  },
  content: {
    flexGrow: 1,
    paddingBottom: spacing.xxl * 2,
    gap: spacing.xxl + spacing.xs,
  },
  gutter: {
    paddingHorizontal: GUTTER,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  headerText: {
    flex: 1,
    gap: spacing.xs,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  newButton: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    backgroundColor: colors.primaryButton.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.7,
  },
  section: {
    gap: spacing.md,
  },
  shelf: {
    gap: spacing.md,
    paddingHorizontal: GUTTER,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 44,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    backgroundColor: colors.surface.raised,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border.card,
  },
  searchInput: {
    flex: 1,
    fontFamily: fontFamily.ui,
    fontSize: 15,
    color: colors.text.primary,
    paddingVertical: spacing.sm,
  },
  sortRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sortButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs + 2,
    minHeight: 44,
  },
  layoutToggle: {
    flexDirection: 'row',
    gap: 2,
    padding: 3,
    borderRadius: radius.pill,
    backgroundColor: colors.surface.sunken,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border.default,
  },
  layoutOption: {
    width: 40,
    height: 32,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  layoutOptionSelected: {
    backgroundColor: colors.surface.raised,
  },
  inlineLoading: {
    paddingVertical: spacing.xl,
    alignItems: 'center',
  },
  empty: {
    alignItems: 'flex-start',
    gap: spacing.md,
    padding: spacing.xl,
    backgroundColor: colors.surface.raised,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border.default,
  },
  emptyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minHeight: 44,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    backgroundColor: colors.primaryButton.bg,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: GRID_GAP,
    rowGap: spacing.lg,
  },
}));
