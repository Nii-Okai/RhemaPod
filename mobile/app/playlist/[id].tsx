import React, { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText, Avatar, DetailError, IconButton, PlatformIcon } from '../../components';
import { colors } from '../../theme/colors';
import { radius } from '../../theme/radius';
import { spacing } from '../../theme/spacing';
import { formatPlaylistMinutes } from '../../lib/format/playlistDuration';
import { shareContent } from '../../lib/share/shareContent';
import { useRecommended } from '../../lib/query/hooks/useRecommended';
import { useAddPlaylistItem, usePlaylist, useRemovePlaylistItem } from '../../lib/query/hooks/usePlaylists';
import { AddToPlaylistSheet } from './_detail/AddToPlaylistSheet';
import { PlaylistCoverPicker } from './_detail/PlaylistCoverPicker';
import { PlaylistDetailsSheet } from './_detail/PlaylistDetailsSheet';
import { PlaylistItemRow } from './_detail/PlaylistItemRow';
import { PlaylistOptionsSheet } from './_detail/PlaylistOptionsSheet';
import { playlistQueueParams, shuffled } from './_detail/playlistQueue';
import { SermonAddRow } from './_detail/SermonAddRow';
import { usePlaylistPreview } from './_detail/usePlaylistPreview';

const COVER_SIZE = 120;

/**
 * Playlist detail (Isaac's screenshots, redesigned session 2026-10-10 to
 * match the reference more closely).
 *
 * Native Stack header disabled (`app/_layout.tsx`), replaced by a plain
 * back-chevron row — the same "bare chevron, no title next to it" header
 * `category/[id].tsx` already established for a list-of-content screen, not
 * sermon/series detail's own Cast+Close chrome (no cast surface here, and
 * this isn't reached via a dismiss-gesture title-page push).
 *
 * Cover sits to the LEFT of the title/owner/visibility block now (was
 * centered above it) — the owner row uses the real `Avatar` component
 * (initials chip off `owner_name`) rather than bare text, matching the
 * reference's small avatar-plus-name row.
 *
 * The icon row (Share, "..." options) is its own row, separate from "Add to
 * this playlist" — which stays centered and alone, same as the reference.
 * Dropped from that icon row: a download-the-whole-playlist action — still
 * no bulk-download-a-playlist pipeline anywhere in this app, and a button
 * that does nothing is worse than one that isn't there (`ActionButton`'s own
 * Set Reminders/Rate precedent).
 *
 * Shuffle and a big "play the whole playlist" circle, previously cut for the
 * same reason, are back (Isaac's ask, session 2026-10-10: "users should be
 * able to play sermons in their playlist") — real queue/autoplay-next now
 * exists, via `playlistQueueParams` and the Player screen's own `queue`/
 * `queueIndex` route params (see that screen's doc comment). Both only
 * render once the playlist has at least one item; each row's own thumbnail
 * tap still opens that one sermon with no queue attached, same as before —
 * only Play/Shuffle start a real multi-item session.
 *
 * "Recommended sermons" (Isaac's ask, same session: "apply appropriate
 * logic") reuses `/me/recommended` — Home's own "Recommended for you" shelf,
 * backed by real category/speaker affinity derived from the caller's
 * playback history (falling back to Trending), not an invented list.
 * Sermons already in this playlist are filtered out client-side rather than
 * shown disabled, since there's no reason to show a row that can't do
 * anything here. The whole section is omitted — no skeleton, no error
 * banner — while loading, erroring, or empty: it's a supplementary
 * discovery aid, not core page content the way the playlist's own item list
 * is.
 *
 * No inline preview on these rows (tried once, session 2026-10-10, reverted
 * Isaac's own follow-up next session: "should ONLY be on the recommended
 * songs ADDED to the playlist") — preview is a playlist-item affordance
 * (`PlaylistItemRow`'s own thumbnail) only, not a discovery-row one; a
 * recommended sermon hasn't been committed to anything yet, it's just a
 * suggestion with an add button.
 *
 * An empty playlist no longer gets its own "No sermons yet" placeholder
 * block (Isaac's ask, session 2026-10-10) — Recommended sermons sits
 * directly under "Add to this playlist" instead, so the first thing a new,
 * empty playlist shows is something fillable, not a dead-end sentence.
 */
export default function PlaylistDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { data: playlist, isLoading, isError, refetch } = usePlaylist(id);
  const removeItem = useRemovePlaylistItem(id ?? '');
  const addItem = useAddPlaylistItem(id ?? '');
  const recommended = useRecommended();
  const preview = usePlaylistPreview();
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [addingRecommendedId, setAddingRecommendedId] = useState<string | null>(null);

  if (isError) {
    return (
      <View style={styles.screen}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={[styles.headerRow, { paddingTop: Math.max(insets.top, spacing.sm) }]}>
          <IconButton icon="chevron-back" accessibilityLabel="Back" onPress={() => router.back()} />
        </View>
        <DetailError onRetry={() => void refetch()} message="Something went wrong loading this playlist." />
      </View>
    );
  }

  if (isLoading || !playlist) {
    return (
      <View style={styles.loading} accessibilityRole="progressbar" accessibilityLabel="Loading playlist">
        <ActivityIndicator color={colors.accent.gold} />
      </View>
    );
  }

  const existingItemIdBySermonId = new Map(playlist.items.map((item) => [item.sermon.id, item.id]));
  const existingSermonIds = new Set(existingItemIdBySermonId.keys());
  const metaLabel = `${playlist.is_public ? 'Public playlist' : 'Private playlist'} · ${formatPlaylistMinutes(playlist.total_duration_seconds)}`;
  const recommendedSermons = (recommended.data ?? []).filter((sermon) => !existingSermonIds.has(sermon.id));

  const addRecommended = (sermonId: string) => {
    setAddingRecommendedId(sermonId);
    addItem.mutate(sermonId, { onSettled: () => setAddingRecommendedId(null) });
  };

  const playAll = () => {
    const params = playlistQueueParams(playlist.id, playlist.items.map((item) => item.sermon.id));
    if (params) router.push({ pathname: '/player/[id]', params });
  };
  const shuffleAll = () => {
    const params = playlistQueueParams(playlist.id, shuffled(playlist.items.map((item) => item.sermon.id)));
    if (params) router.push({ pathname: '/player/[id]', params });
  };

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={[styles.headerRow, { paddingTop: Math.max(insets.top, spacing.sm) }]}>
          <IconButton icon="chevron-back" accessibilityLabel="Back" onPress={() => router.back()} />
        </View>

        <View style={styles.infoRow}>
          <PlaylistCoverPicker playlistId={playlist.id} coverUrl={playlist.cover_url} size={COVER_SIZE} />
          <View style={styles.infoText}>
            <AppText variant="display.row" numberOfLines={3} style={styles.title}>
              {playlist.name}
            </AppText>
            {playlist.description ? (
              <AppText variant="ui.body" tone="secondary" numberOfLines={2}>
                {playlist.description}
              </AppText>
            ) : null}
            {playlist.owner_name ? (
              <View style={styles.ownerRow}>
                <Avatar name={playlist.owner_name} size={22} />
                <AppText variant="ui.body" tone="secondary">
                  {playlist.owner_name}
                </AppText>
              </View>
            ) : null}
            <View style={styles.metaRow}>
              <PlatformIcon
                name={playlist.is_public ? 'globe-outline' : 'lock-closed-outline'}
                size={13}
                color={colors.text.tertiary}
              />
              <AppText variant="ui.body" tone="tertiary">
                {metaLabel}
              </AppText>
            </View>
          </View>
        </View>

        <View style={styles.iconRow}>
          <View style={styles.iconRowGroup}>
            <IconButton
              icon="share-outline"
              accessibilityLabel="Share"
              onPress={() =>
                void shareContent({
                  title: playlist.name,
                  description: playlist.description,
                  thumbnailUrl: playlist.cover_url,
                  deepLinkPath: `playlist/${playlist.id}`,
                })
              }
            />
            <IconButton icon="ellipsis-horizontal" accessibilityLabel="More options" onPress={() => setOptionsOpen(true)} />
          </View>
          {playlist.items.length > 0 ? (
            <View style={styles.iconRowGroup}>
              <IconButton icon="shuffle" accessibilityLabel="Shuffle play this playlist" onPress={shuffleAll} />
              <Pressable
                onPress={playAll}
                accessibilityRole="button"
                accessibilityLabel="Play this playlist"
                style={({ pressed }) => [styles.playCircle, pressed && styles.pressed]}
              >
                <PlatformIcon name="play" size={20} color={colors.primaryButton.text} />
              </Pressable>
            </View>
          ) : null}
        </View>

        <Pressable
          onPress={() => setAddOpen(true)}
          accessibilityRole="button"
          accessibilityLabel="Add to this playlist"
          style={({ pressed }) => [styles.addButton, pressed && styles.pressed]}
        >
          <PlatformIcon name="add" size={18} color={colors.primaryButton.text} />
          <AppText variant="ui.button" tone="inverse">
            Add to this playlist
          </AppText>
        </Pressable>

        {playlist.items.length > 0 ? (
          <View style={styles.list}>
            {playlist.items.map((item) => (
              <PlaylistItemRow
                key={item.id}
                item={item}
                onPress={() => router.push({ pathname: '/player/[id]', params: { id: item.sermon.id } })}
                onRemove={() => removeItem.mutate(item.id)}
                isPreviewPlaying={preview.activeSermonId === item.sermon.id}
                isPreviewLoading={preview.isLoading(item.sermon.id)}
                onTogglePreview={() => preview.toggle(item.sermon.id)}
              />
            ))}
          </View>
        ) : null}

        {recommendedSermons.length > 0 ? (
          <View style={styles.recommendedSection}>
            <AppText variant="display.compact">Recommended sermons</AppText>
            <View style={styles.list}>
              {recommendedSermons.map((sermon) => (
                <SermonAddRow
                  key={sermon.id}
                  sermon={sermon}
                  isAdding={addingRecommendedId === sermon.id}
                  onAdd={() => addRecommended(sermon.id)}
                />
              ))}
            </View>
          </View>
        ) : null}
      </ScrollView>

      <PlaylistOptionsSheet
        visible={optionsOpen}
        onClose={() => setOptionsOpen(false)}
        onShare={() =>
          void shareContent({
            title: playlist.name,
            description: playlist.description,
            thumbnailUrl: playlist.cover_url,
            deepLinkPath: `playlist/${playlist.id}`,
          })
        }
        onAdd={() => setAddOpen(true)}
        onEditDetails={() => setDetailsOpen(true)}
      />
      <PlaylistDetailsSheet
        visible={detailsOpen}
        onClose={() => setDetailsOpen(false)}
        playlist={playlist}
        onDeleted={() => router.back()}
      />
      <AddToPlaylistSheet
        visible={addOpen}
        onClose={() => setAddOpen(false)}
        playlistId={playlist.id}
        existingItemIdBySermonId={existingItemIdBySermonId}
        onRemove={(itemId) => removeItem.mutate(itemId)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.surface.app,
  },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface.app,
  },
  content: {
    paddingBottom: spacing.xxl * 2,
  },
  headerRow: {
    // Without this, the row's default `alignItems: 'stretch'` stretches the back
    // button's own Pressable to the row's full width, centering the chevron in the
    // middle of the screen instead of pinning it to the left edge.
    alignItems: 'flex-start',
    paddingHorizontal: spacing.xs,
  },
  infoRow: {
    flexDirection: 'row',
    gap: spacing.lg,
    padding: spacing.lg,
  },
  infoText: {
    flex: 1,
    justifyContent: 'center',
    gap: spacing.xs,
  },
  title: {
    marginBottom: spacing.xs,
  },
  ownerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  iconRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
  },
  iconRowGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  playCircle: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    backgroundColor: colors.primaryButton.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addButton: {
    flexDirection: 'row',
    alignSelf: 'center',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.primaryButton.bg,
    borderRadius: radius.pill,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xl,
    marginBottom: spacing.lg,
  },
  pressed: {
    opacity: 0.85,
  },
  list: {
    gap: spacing.xs,
    paddingHorizontal: spacing.lg,
  },
  recommendedSection: {
    gap: spacing.md,
    marginTop: spacing.xl,
    paddingHorizontal: spacing.lg,
  },
});
