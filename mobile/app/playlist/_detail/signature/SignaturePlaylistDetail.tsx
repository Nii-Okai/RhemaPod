import React, { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText, Avatar, DetailError, DetailNotAvailable, IconButton, PlatformIcon, PressableScale, StaggerItem } from '../../../../components';
import type { AppIconName } from '../../../../components/PlatformIcon';
import { createThemedStyles, useTheme } from '../../../../theme/ThemeContext';
import { radius } from '../../../../theme/radius';
import { spacing } from '../../../../theme/spacing';
import { isNotFoundError } from '../../../../lib/api/errors';
import { formatPlaylistMinutes } from '../../../../lib/format/playlistDuration';
import { shareContent } from '../../../../lib/share/shareContent';
import { useRecommended } from '../../../../lib/query/hooks/useRecommended';
import { useAddPlaylistItem, usePlaylist, useRemovePlaylistItem } from '../../../../lib/query/hooks/usePlaylists';
import { Flame } from '../../../(tabs)/_home/signature/Flame';
import { LEAF } from '../../../(tabs)/_home/signature/leaf';
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

const GUTTER = spacing.lg;
const MAX_COVER = 240;

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
      <AppText variant="ui.actionLabel">{label}</AppText>
    </Pressable>
  );
}

/**
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
  const { width: windowWidth } = useWindowDimensions();
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
      <IconButton icon="chevron-back" accessibilityLabel="Back" onPress={() => router.back()} />
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

  const coverSize = Math.min(windowWidth - GUTTER * 2, MAX_COVER);
  const existingItemIdBySermonId = new Map(playlist.items.map((item) => [item.sermon.id, item.id]));
  const recommendedSermons = (recommended.data ?? []).filter((sermon) => !existingItemIdBySermonId.has(sermon.id));
  const hasItems = playlist.items.length > 0;
  const itemCount = playlist.items.length === 1 ? '1 item' : `${playlist.items.length} items`;
  const kicker = [
    playlist.is_public ? 'Public playlist' : 'Private playlist',
    itemCount,
    formatPlaylistMinutes(playlist.total_duration_seconds),
  ]
    .join(' · ')
    .toUpperCase();

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
            <IconButton icon="ellipsis-horizontal" accessibilityLabel="More options" onPress={() => setOptionsOpen(true)} />
          ) : undefined,
        )}

        <View style={styles.coverWrap}>
          <View style={[styles.coverShadow, LEAF]}>
            {isOwner ? (
              <PlaylistCoverPicker
                playlistId={playlist.id}
                coverUrl={playlist.cover_url}
                size={coverSize}
                cover={<PlaylistCover name={playlist.name} coverUrl={playlist.cover_url} size={coverSize} shape={LEAF} />}
              />
            ) : (
              <PlaylistCover name={playlist.name} coverUrl={playlist.cover_url} size={coverSize} shape={LEAF} />
            )}
          </View>
        </View>

        <View style={styles.info}>
          <View style={styles.kicker}>
            <PlatformIcon
              name={playlist.is_public ? 'globe-outline' : 'lock-closed-outline'}
              size={12}
              color={colors.text.tertiary}
            />
            <AppText variant="mono.meta" tone="tertiary">
              {kicker}
            </AppText>
          </View>
          <AppText variant="display.hero" accessibilityRole="header">
            {playlist.name}
          </AppText>
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

        <View style={styles.gutter}>
          {hasItems ? (
            <PressableScale
              onPress={() => startQueue(ids())}
              accessibilityRole="button"
              accessibilityLabel="Play this playlist"
              style={styles.playPill}
            >
              <PlatformIcon name="play" size={18} color={colors.primaryButton.text} />
              <AppText variant="ui.button" tone="inverse">
                Play
              </AppText>
            </PressableScale>
          ) : isOwner ? (
            <PressableScale
              onPress={() => setAddOpen(true)}
              accessibilityRole="button"
              accessibilityLabel="Add to this playlist"
              style={styles.playPill}
            >
              <PlatformIcon name="add" size={18} color={colors.primaryButton.text} />
              <AppText variant="ui.button" tone="inverse">
                Add to this playlist
              </AppText>
            </PressableScale>
          ) : null}
        </View>

        <View style={styles.actions}>
          {isOwner ? <Action icon="add" label="Add" onPress={() => setAddOpen(true)} /> : null}
          <Action icon="shuffle" label="Shuffle" onPress={() => startQueue(shuffled(ids()))} disabled={!hasItems} />
          <Action icon="share-outline" label="Share" onPress={share} disabled={shareDisabled} />
          {isOwner ? <Action icon="pencil" label="Edit" onPress={() => setDetailsOpen(true)} /> : null}
        </View>

        {hasItems ? (
          <View style={styles.section}>
            <View style={styles.sectionLabel}>
              <Flame width={8} fill={colors.accent.gold} />
              <AppText variant="mono.meta" tone="tertiary" accessibilityRole="header">
                {`IN THIS PLAYLIST · ${playlist.items.length}`}
              </AppText>
            </View>
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
            <AppText variant="display.section" accessibilityRole="header">
              Recommended sermons
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
    gap: spacing.xl,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xs,
  },
  gutter: {
    paddingHorizontal: GUTTER,
  },
  coverWrap: {
    alignItems: 'center',
  },
  coverShadow: {
    backgroundColor: colors.surface.sunken,
    shadowColor: colors.shadow.card,
    shadowOpacity: 1,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 16 },
    elevation: 8,
  },
  info: {
    paddingHorizontal: GUTTER,
    gap: spacing.sm,
  },
  kicker: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs + 2,
  },
  owner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  playPill: {
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.primaryButton.bg,
  },
  actions: {
    flexDirection: 'row',
    paddingHorizontal: spacing.sm,
  },
  action: {
    flex: 1,
    minHeight: 64,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  pressed: {
    opacity: 0.7,
  },
  dimmed: {
    opacity: 0.45,
  },
  section: {
    paddingHorizontal: GUTTER,
    gap: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border.default,
  },
  sectionLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingTop: spacing.md,
  },
  list: {
    gap: spacing.sm,
  },
}));
