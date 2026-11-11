import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, TextInput, View } from 'react-native';
import { AppText, PlatformIcon, Sheet } from '../../../../components';
import { createThemedStyles, useTheme } from '../../../../theme/ThemeContext';
import { spacing } from '../../../../theme/spacing';
import { fontFamily } from '../../../../theme/typography';
import { userMessageFor } from '../../../../lib/api/errors';
import { useDebouncedValue } from '../../../../lib/hooks/useDebouncedValue';
import { useDownloads } from '../../../../lib/downloads/useDownloads';
import { useSearchResultsInfinite } from '../../../../lib/query/hooks/useSearch';
import { useAddPlaylistItem } from '../../../../lib/query/hooks/usePlaylists';
import { SegmentedControl } from '../../../(tabs)/_library/signature/SegmentedControl';
import type { AddToPlaylistSheetProps } from '../AddToPlaylistSheet';
import type { AddableSermon } from '../SermonAddRow';
import { SignatureSermonAddRow } from './SignatureSermonRows';

type SheetTab = 'sermons' | 'episodes' | 'downloaded';

/**
 * "Add to playlist", Signature redesign. Same behaviour as the classic sheet — Sermons and
 * Episodes split client-side from one fully-paged `/search` browse read, Downloaded from
 * the device, the search field narrowing whichever tab is open, tap a gold check to take
 * an item back out — with a Newsreader heading, a running "N IN THIS PLAYLIST" tally and
 * the segmented track for the tabs.
 */
export function SignatureAddToPlaylistSheet({
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

  // Page through the whole result set (see the classic sheet for why).
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
  const rows: AddableSermon[] =
    tab === 'downloaded' ? downloadRows : allSermons.filter((sermon) => (tab === 'episodes') === (sermon.series_id !== null));

  const isLoading = tab !== 'downloaded' && results.isLoading;
  const isError = tab !== 'downloaded' && results.isError;
  const emptyMessage = tab === 'sermons' ? 'No sermons found.' : tab === 'episodes' ? 'No episodes found.' : 'No downloads yet.';
  const inPlaylist = existingItemIdBySermonId.size;

  return (
    <Sheet visible={visible} onClose={onClose}>
      <View style={styles.headRow}>
        <View style={styles.heading}>
          <AppText variant="display.row" accessibilityRole="header">
            Add to playlist
          </AppText>
          <AppText variant="ui.badge" tone="tertiary">
            {`${inPlaylist} in this playlist`}
          </AppText>
        </View>
        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Done"
          style={({ pressed }) => [styles.done, pressed && styles.pressed]}
        >
          <AppText variant="ui.button" style={styles.doneText}>
            Done
          </AppText>
        </Pressable>
      </View>

      <SegmentedControl<SheetTab>
        accessibilityLabel="Add from"
        value={tab}
        onChange={setTab}
        segments={[
          { key: 'sermons', label: 'Sermons' },
          { key: 'episodes', label: 'Episodes' },
          { key: 'downloaded', label: 'Downloaded' },
        ]}
      />

      <View style={styles.searchRow}>
        <PlatformIcon name="search" size={20} color={colors.text.tertiary} />
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
      ) : rows.length === 0 ? (
        <AppText variant="ui.body" tone="secondary">
          {emptyMessage}
        </AppText>
      ) : (
        <ScrollView style={styles.results} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          {rows.map((sermon) => {
            const existingItemId = existingItemIdBySermonId.get(sermon.id);
            return (
              <SignatureSermonAddRow
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
  headRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  heading: {
    flex: 1,
    gap: 2,
  },
  // Daybreak (canvas E4): a small ink pill.
  done: {
    height: 44,
    paddingHorizontal: spacing.lg + 2,
    borderRadius: 22,
    justifyContent: 'center',
    backgroundColor: colors.text.primary,
  },
  doneText: {
    color: colors.surface.app,
  },
  pressed: {
    opacity: 0.8,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 2,
    minHeight: 54,
    paddingHorizontal: spacing.lg,
    borderRadius: 16,
    backgroundColor: colors.surface.raised,
    borderWidth: 1.5,
    borderColor: colors.border.default,
  },
  searchInput: {
    flex: 1,
    fontFamily: fontFamily.ui,
    fontSize: 15,
    color: colors.text.primary,
    paddingVertical: spacing.sm,
  },
  results: {
    maxHeight: 400,
  },
}));
