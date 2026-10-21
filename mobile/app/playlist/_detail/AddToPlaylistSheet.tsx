import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, TextInput, View } from 'react-native';
import { AppText, PlatformIcon, Sheet } from '../../../components';
import { createThemedStyles, useTheme } from '../../../theme/ThemeContext';
import { radius } from '../../../theme/radius';
import { spacing } from '../../../theme/spacing';
import { fontFamily } from '../../../theme/typography';
import { userMessageFor } from '../../../lib/api/errors';
import { useDebouncedValue } from '../../../lib/hooks/useDebouncedValue';
import { useDownloads } from '../../../lib/downloads/useDownloads';
import { useSearchResultsInfinite } from '../../../lib/query/hooks/useSearch';
import { useAddPlaylistItem } from '../../../lib/query/hooks/usePlaylists';
import { SermonAddRow, type AddableSermon } from './SermonAddRow';

export interface AddToPlaylistSheetProps {
  visible: boolean;
  onClose: () => void;
  playlistId: string;
  /** Sermon id -> that playlist item's own id, for everything already in this playlist
   * (`[id].tsx`'s own `playlist.items`) — shown with a sage checkmark instead of a "+",
   * and tapping that checkmark removes the item (Isaac's ask, session 2026-10-10: "users
   * should be able to click on the checked icon to uncheck/remove item"), via `onRemove`
   * below. A plain `Set<string>` of sermon ids isn't enough for that — removing a
   * playlist item needs the item's own id, not the sermon's (`DELETE .../items/{item_id}`). */
  existingItemIdBySermonId: Map<string, string>;
  onRemove: (itemId: string) => void;
}

type SheetTab = 'sermons' | 'episodes' | 'downloaded';

const TABS: { key: SheetTab; label: string }[] = [
  { key: 'sermons', label: 'Sermons' },
  { key: 'episodes', label: 'Episodes' },
  { key: 'downloaded', label: 'Downloaded' },
];

/**
 * "Add to Playlist" (Isaac's screenshots). Rebuilt session 2026-10-10 from a
 * single flat search list into the reference's own tabbed version:
 * Sermons / Episodes / Downloaded, each a real browsable default list (not
 * gated behind typing a query first), with the search field narrowing
 * whichever tab is active.
 *
 * Sermons vs. Episodes is one shared `/search` browse-mode read (empty `q`
 * is this endpoint's own documented "browse" mode, same call `category/
 * [id].tsx` makes), split client-side on `series_id` — a series episode
 * already IS a sermon (`Sermon.series_id`), there's no second endpoint or
 * content type behind the two tabs, just a filter over one result set. That
 * shared read pages through every matching result via `useSearchResultsInfinite`
 * (Isaac's report, same session: "not all episodes are showing" — the plain
 * hook's implicit 20-result cap was shared across both tabs, so whichever one
 * sorted past it came up short; there's no server-side "episodes only" filter
 * to split the fetch on instead, so paging to completion is the real fix).
 * Downloaded reuses `useDownloads()` directly — full title/thumbnail already
 * sit on-device, no fetch needed, filtered by title substring client-side
 * like every other local list in this app does its own search.
 *
 * The reference's fourth pill, "Recently played", is left out (Isaac's own
 * call when asked how to source it): this app has no endpoint returning
 * full playback history with title/thumbnail — `/me/history` is ids and
 * progress numbers only — and reusing `/me/continue-watching` under a
 * "Recently played" label would silently exclude anything already finished,
 * which is a real, confusing gap for a tab with that name.
 */
export function AddToPlaylistSheet({
  visible,
  onClose,
  playlistId,
  existingItemIdBySermonId,
  onRemove,
}: AddToPlaylistSheetProps) {
  const { colors } = useTheme();
  const styles = useStyles();
  const [tab, setTab] = useState<SheetTab>('sermons');
  const [query, setQuery] = useState('');
  const debounced = useDebouncedValue(query, 300);
  const trimmed = debounced.trim();
  const normalizedQuery = trimmed.toLowerCase();

  const results = useSearchResultsInfinite({ q: trimmed || undefined }, { enabled: visible && tab !== 'downloaded' });
  const downloads = useDownloads();
  const addItem = useAddPlaylistItem(playlistId);
  const [addingId, setAddingId] = useState<string | null>(null);

  // Keep paging until the whole result set is in — see the file-level doc comment.
  useEffect(() => {
    if (results.hasNextPage && !results.isFetchingNextPage) {
      void results.fetchNextPage();
    }
  }, [results.hasNextPage, results.isFetchingNextPage, results.fetchNextPage]);

  const add = (sermonId: string) => {
    setAddingId(sermonId);
    addItem.mutate(sermonId, { onSettled: () => setAddingId(null) });
  };

  const downloadedSermonIds = new Set(downloads.downloads.map((d) => d.sermonId));

  const downloadRows: AddableSermon[] = downloads.downloads
    .filter((d) => !normalizedQuery || d.title.toLowerCase().includes(normalizedQuery))
    .map((d) => ({ id: d.sermonId, title: d.title, thumbnail_url: d.thumbnailPath ?? d.thumbnailUrl, category_name: d.category }));

  const allSermons = results.data?.pages.flatMap((page) => page.results) ?? [];
  const activeRows: AddableSermon[] =
    tab === 'downloaded' ? downloadRows : allSermons.filter((sermon) => (tab === 'episodes') === (sermon.series_id !== null));

  const isLoading = tab !== 'downloaded' && results.isLoading;
  const isError = tab !== 'downloaded' && results.isError;
  const emptyMessage =
    tab === 'sermons' ? 'No sermons found.' : tab === 'episodes' ? 'No episodes found.' : 'No downloads yet.';

  return (
    <Sheet visible={visible} onClose={onClose}>
      <AppText variant="ui.label" tone="tertiary" accessibilityRole="header" style={styles.heading}>
        Add to playlist
      </AppText>

      <View style={styles.tabRow}>
        {TABS.map((t) => {
          const selected = t.key === tab;
          return (
            <Pressable
              key={t.key}
              onPress={() => setTab(t.key)}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              style={[styles.tabPill, selected && styles.tabPillSelected]}
            >
              <AppText variant="ui.button" tone={selected ? 'inverse' : 'primary'}>
                {t.label}
              </AppText>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.searchRow}>
        <PlatformIcon name="search" size={16} color={colors.text.tertiary} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="What would you like to add?"
          placeholderTextColor={colors.text.tertiary}
          style={styles.searchInput}
          accessibilityLabel="Search sermons"
        />
      </View>

      {isLoading ? (
        <ActivityIndicator color={colors.accent.gold} />
      ) : isError ? (
        <AppText variant="ui.body" tone="secondary">
          {userMessageFor(results.error)}
        </AppText>
      ) : activeRows.length === 0 ? (
        <AppText variant="ui.body" tone="secondary">
          {emptyMessage}
        </AppText>
      ) : (
        <ScrollView style={styles.resultsScroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          {activeRows.map((sermon) => {
            const existingItemId = existingItemIdBySermonId.get(sermon.id);
            return (
              <SermonAddRow
                key={sermon.id}
                sermon={sermon}
                alreadyAdded={existingItemId !== undefined}
                isDownloaded={downloadedSermonIds.has(sermon.id)}
                isAdding={addingId === sermon.id}
                onAdd={() => add(sermon.id)}
                onRemove={existingItemId !== undefined ? () => onRemove(existingItemId) : undefined}
              />
            );
          })}
        </ScrollView>
      )}
    </Sheet>
  );
}

const useStyles = createThemedStyles((colors) => ({
  heading: {
    textTransform: 'uppercase',
  },
  tabRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  tabPill: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.chip.square,
  },
  tabPillSelected: {
    backgroundColor: colors.text.primary,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface.raised,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
  },
  searchInput: {
    flex: 1,
    fontFamily: fontFamily.ui,
    fontSize: 15,
    color: colors.text.primary,
    paddingVertical: spacing.sm,
  },
  resultsScroll: {
    maxHeight: 360,
  },
}));
