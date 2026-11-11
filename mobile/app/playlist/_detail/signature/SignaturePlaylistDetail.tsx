import React, { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText, Avatar, CircleButton, DetailError, DetailNotAvailable, PlatformIcon, StaggerItem } from '../../../../components';
import type { AppIconName } from '../../../../components/PlatformIcon';
import { createThemedStyles, useTheme } from '../../../../theme/ThemeContext';
import { radius } from '../../../../theme/radius';
import { spacing } from '../../../../theme/spacing';
import { isNotFoundError } from '../../../../lib/api/errors';
import { formatPlaylistMinutes } from '../../../../lib/format/playlistDuration';
import { shareContent } from '../../../../lib/share/shareContent';
import { useRecommended } from '../../../../lib/query/hooks/useRecommended';
import { useAddPlaylistItem, usePlaylist, useRemovePlaylistItem } from '../../../../lib/query/hooks/usePlaylists';
import { PlaylistCover } from '../../../(tabs)/_library/signature/PlaylistCover';
import { PlaylistCoverPicker } from '../PlaylistCoverPicker';
import { PlaylistDetailsSheet } from '../PlaylistDetailsSheet';
import { PlaylistOptionsSheet } from '../PlaylistOptionsSheet';
import { playlistQueueParams, shuffled } from '../playlistQueue';
import { useMakePlaylistPublic } from '../useMakePlaylistPublic';
import { usePlaylistPreview } from '../usePlaylistPreview';
import { SignatureAddToPlaylistSheet } from './SignatureAddToPlaylistSheet';
import { SignaturePlaylistItemRow, SignatureSermonAddRow } from './SignatureSermonRows';
import { usePullToRefresh } from '../../../../lib/hooks/usePullToRefresh';

const GUTTER = spacing.lg + 4;
const COVER = 132;
const COVER_SHAPE = { borderRadius: 24, overflow: 'hidden' as const };

function Action({ icon, label, onPress, disabled }: { icon: AppIconName; label: string; onPress: () => void; disabled?: boolean }) {
  const { colors } = useTheme();
  const styles = useStyles();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      style={({ pressed }) => [styles.action, pressed && styles.pressed, disabled && styles.dimmed]}
    >
      <PlatformIcon name={icon} size={22} color={colors.text.primary} />
    </Pressable>
  );
}

/**
 * Daybreak redesign (canvas E2): round Back and More buttons; the 132pt cover beside a
 * "Playlist · Private" eyebrow, the name and its length; Play beside round Shuffle,
 * Share and Edit; a dashed "Add to this playlist" row heading the list.
 *
 * Playlist detail, Signature redesign, behind `SIGNATURE_LIBRARY_ENABLED`. Same features
 * as the classic screen (see `app/playlist/[id].tsx`): cover upload, Play/Shuffle as a
 * real queue, share, the options and details sheets, swipe-to-remove, inline previews
 * and Recommended sermons. Laid out like the Series page in the Signature mockup: a large
 * leaf-cornered cover, a mono kicker, the Newsreader title, one full-width Play pill and
 * a four-up action row.
 */
export function SignaturePlaylistDetailScreen() {
  const { colors } = useTheme();
  const styles = useStyles();
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { data: playlist, isLoading, isError, error, refetch } = usePlaylist(id);
  const removeItem = useRemovePlaylistItem(id ?? '');
  const addItem = useAddPlaylistItem(id ?? '');
  const makePublic = useMakePlaylistPublic(id ?? '');
  const recommended = useRecommended();
  const pullToRefresh = usePullToRefresh([refetch]);
  const preview = usePlaylistPreview();
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [addingRecommendedId, setAddingRecommendedId] = useState<string | null>(null);

  const topBar = (trailing?: React.ReactNode) => (
    <View style={[styles.topBar, { paddingTop: Math.max(insets.top, spacing.sm) }]}>
      <CircleButton icon="chevron-back" accessibilityLabel="Back" onPress={() => router.back()} />
      {trailing}
    </View>
  );

  if (isNotFoundError(error)) {
    return (
      <View style={styles.screen}>
        <Stack.Screen options={{ headerShown: false }} />
        {topBar()}
        <DetailNotAvailable subject="playlist" onGoHome={() => router.replace('/')} />
      </View>
    );
  }

  if (isError) {
    return (
      <View style={styles.screen}>
        <Stack.Screen options={{ headerShown: false }} />
        {topBar()}
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
  const recommendedSermons = (recommended.data ?? []).filter((sermon) => !existingItemIdBySermonId.has(sermon.id));
  const hasItems = playlist.items.length > 0;
  const itemCount = playlist.items.length === 1 ? '1 item' : `${playlist.items.length} items`;
  const kicker = `Playlist · ${playlist.is_public ? 'Public' : 'Private'}`.toUpperCase();
  const meta = `${itemCount} · ${formatPlaylistMinutes(playlist.total_duration_seconds)}`;

  const isOwner = playlist.is_owner;
  const openShareSheet = () =>
    void shareContent({
      title: playlist.name,
      description: playlist.description,
      deepLinkPath: `playlist/${playlist.id}`,
    });
  // Sharing a private playlist first asks to make it public (the link is useless to a
  // recipient otherwise): No does nothing, Yes PATCHes and opens the share sheet only once
  // that succeeded. The flow itself is shared with the Name & details toggle.
  const share = () => {
    if (!isOwner || playlist.is_public) {
      openShareSheet();
      return;
    }
    makePublic.confirmAndMakePublic({
      onSuccess: openShareSheet,
      onFailure: (message) => Alert.alert("Couldn't share this playlist", message),
    });
  };
  const shareDisabled = isOwner && !playlist.is_public && (!makePublic.ready || makePublic.busy);
  const addRecommended = (sermonId: string) => {
    setAddingRecommendedId(sermonId);
    addItem.mutate(sermonId, { onSettled: () => setAddingRecommendedId(null) });
  };
  const startQueue = (order: string[]) => {
    const params = playlistQueueParams(playlist.id, order);
    if (params) router.push({ pathname: '/player/[id]', params });
  };
  const ids = () => playlist.items.map((item) => item.sermon.id);

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl {...pullToRefresh} />}
      >
        {topBar(
          isOwner ? (
            <CircleButton icon="ellipsis-horizontal" accessibilityLabel="More options" onPress={() => setOptionsOpen(true)} />
          ) : undefined,
        )}

        {/* Daybreak (canvas E2): the cover beside its name, then Play and round buttons. */}
        <View style={styles.headRow}>
          <View style={[styles.coverShadow, COVER_SHAPE]}>
            {isOwner ? (
              <PlaylistCoverPicker
                playlistId={playlist.id}
                coverUrl={playlist.cover_url}
                size={COVER}
                cover={<PlaylistCover name={playlist.name} coverUrl={playlist.cover_url} size={COVER} shape={COVER_SHAPE} />}
              />
            ) : (
              <PlaylistCover name={playlist.name} coverUrl={playlist.cover_url} size={COVER} shape={COVER_SHAPE} />
            )}
          </View>
          <View style={styles.info}>
            <View style={styles.kicker}>
              <PlatformIcon
                name={playlist.is_public ? 'globe-outline' : 'lock-closed-outline'}
                size={12}
                color={colors.text.tertiary}
              />
              <AppText variant="ui.badge" tone="tertiary" style={styles.eyebrow}>
                {kicker}
              </AppText>
            </View>
            <AppText variant="display.title" accessibilityRole="header" numberOfLines={3}>
              {playlist.name}
            </AppText>
            <AppText variant="ui.badge" tone="tertiary">
              {meta}
            </AppText>
          </View>
        </View>

        {playlist.description || playlist.owner_name ? (
          <View style={styles.gutterCol}>
            {playlist.description ? (
              <AppText variant="ui.body" tone="secondary">
                {playlist.description}
              </AppText>
            ) : null}
            {playlist.owner_name ? (
              <View style={styles.owner}>
                <Avatar name={playlist.owner_name} size={22} />
                <AppText variant="ui.body" tone="secondary">
                  {playlist.owner_name}
                </AppText>
              </View>
            ) : null}
          </View>
        ) : null}

        <View style={styles.actions}>
          {hasItems ? (
            // A plain Pressable: PressableScale styles its inner view, so `flex: 1` never
            // reached the row and the pill collapsed to a circle (Nii's phone test).
            <Pressable
              onPress={() => startQueue(ids())}
              accessibilityRole="button"
              accessibilityLabel="Play this playlist"
              style={({ pressed }) => [styles.playPill, pressed && styles.pressed]}
            >
              <PlatformIcon name="play" size={18} color={colors.primaryButton.text} />
              <AppText variant="ui.button" style={styles.playText}>
                Play
              </AppText>
            </Pressable>
          ) : (
            <View style={styles.grow} />
          )}
          <Action icon="shuffle" label="Shuffle" onPress={() => startQueue(shuffled(ids()))} disabled={!hasItems} />
          <Action icon="share-outline" label="Share" onPress={share} disabled={shareDisabled} />
          {isOwner ? <Action icon="pencil" label="Edit" onPress={() => setDetailsOpen(true)} /> : null}
        </View>

        {isOwner ? (
          <View style={styles.gutter}>
            <Pressable
              onPress={() => setAddOpen(true)}
              accessibilityRole="button"
              accessibilityLabel="Add to this playlist"
              style={({ pressed }) => [styles.addRow, pressed && styles.pressed]}
            >
              <View style={styles.addTile}>
                <PlatformIcon name="add" size={24} color={colors.iris.fill} />
              </View>
              <AppText variant="ui.bodyBold" style={styles.addText}>
                Add to this playlist
              </AppText>
            </Pressable>
          </View>
        ) : null}

        {hasItems ? (
          <View style={styles.section}>
            <AppText variant="ui.badge" tone="tertiary" accessibilityRole="header" style={styles.eyebrow}>
              {`IN THIS PLAYLIST · ${playlist.items.length}`}
            </AppText>
            <View style={styles.list}>
              {playlist.items.map((item, index) => (
                <StaggerItem key={item.id} index={index}>
                  <SignaturePlaylistItemRow
                    item={item}
                    position={index + 1}
                    onPress={() => router.push({ pathname: '/player/[id]', params: { id: item.sermon.id } })}
                    onRemove={isOwner ? () => removeItem.mutate(item.id) : undefined}
                    isPreviewPlaying={preview.activeSermonId === item.sermon.id}
                    isPreviewLoading={preview.isLoading(item.sermon.id)}
                    onTogglePreview={() => preview.toggle(item.sermon.id)}
                  />
                </StaggerItem>
              ))}
            </View>
          </View>
        ) : null}

        {isOwner && recommendedSermons.length > 0 ? (
          <View style={styles.section}>
            <AppText variant="ui.badge" tone="tertiary" accessibilityRole="header" style={styles.eyebrow}>
              RECOMMENDED FOR THIS PLAYLIST
            </AppText>
            <View>
              {recommendedSermons.map((sermon) => (
                <SignatureSermonAddRow
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

      {isOwner ? (
        <>
          <PlaylistOptionsSheet
            visible={optionsOpen}
            onClose={() => setOptionsOpen(false)}
            onShare={share}
            onAdd={() => setAddOpen(true)}
            onEditDetails={() => setDetailsOpen(true)}
          />
          <PlaylistDetailsSheet
            visible={detailsOpen}
            onClose={() => setDetailsOpen(false)}
            playlist={playlist}
            onDeleted={() => router.back()}
          />
          <SignatureAddToPlaylistSheet
            visible={addOpen}
            onClose={() => setAddOpen(false)}
            playlistId={playlist.id}
            existingItemIdBySermonId={existingItemIdBySermonId}
            onRemove={(itemId) => removeItem.mutate(itemId)}
          />
        </>
      ) : null}
    </View>
  );
}

const useStyles = createThemedStyles((colors) => ({
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
    gap: spacing.lg + 2,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: GUTTER,
  },
  gutter: {
    paddingHorizontal: GUTTER,
  },
  gutterCol: {
    paddingHorizontal: GUTTER,
    gap: spacing.sm,
  },
  headRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.lg,
    paddingHorizontal: GUTTER,
    paddingTop: spacing.sm,
  },
  coverShadow: {
    backgroundColor: colors.surface.sunken,
    shadowColor: colors.shadow.card,
    shadowOpacity: 1,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 14 },
    elevation: 8,
  },
  info: {
    flex: 1,
    gap: 6,
  },
  kicker: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs + 2,
  },
  eyebrow: {
    letterSpacing: 1.5,
  },
  owner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 2,
    paddingHorizontal: GUTTER,
  },
  grow: {
    flex: 1,
  },
  playPill: {
    flex: 1,
    height: 54,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.primaryButton.bg,
  },
  playText: {
    color: colors.primaryButton.text,
  },
  action: {
    width: 54,
    height: 54,
    borderRadius: 27,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface.raised,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border.default,
  },
  pressed: {
    opacity: 0.7,
  },
  dimmed: {
    opacity: 0.45,
  },
  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md + 2,
    paddingVertical: spacing.xs,
  },
  addTile: {
    width: 56,
    height: 56,
    borderRadius: 14,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: colors.iris.fill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addText: {
    color: colors.iris.fill,
  },
  section: {
    paddingHorizontal: GUTTER,
    gap: spacing.md,
  },
  list: {
    gap: spacing.sm,
  },
}));
