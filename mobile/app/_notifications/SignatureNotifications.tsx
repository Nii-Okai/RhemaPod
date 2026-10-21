import React, { useState } from 'react';
import { Image, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText, IconButton, PlatformIcon, PressableScale, QueryState, StaggerItem } from '../../components';
import { darkColors as onArt } from '../../theme/colors';
import { createThemedStyles, useTheme } from '../../theme/ThemeContext';
import { radius } from '../../theme/radius';
import { spacing } from '../../theme/spacing';
import { fontFamily } from '../../theme/typography';
import { formatDuration } from '../../lib/format/duration';
import { useNewReleases } from '../../lib/query/hooks/useNewReleases';
import { useNotificationsBadge } from '../../lib/query/hooks/useNotificationsBadge';
import type { SermonListItem } from '../../lib/query/hooks/useSermons';
import { Flame } from '../(tabs)/_home/signature/Flame';
import { LEAF, leaf } from '../(tabs)/_home/signature/leaf';
import { formatWhen, isFresh, splitNotifications } from './notificationTime';

const ROW_ART_WIDTH = 96;
const ROW_LEAF = leaf(12, 3);

/** "Category · 1:48", or whichever half exists. */
function categoryAndLength(sermon: SermonListItem): string | null {
  const parts = [sermon.category_name, sermon.duration_seconds ? formatDuration(sermon.duration_seconds) : null];
  const text = parts.filter(Boolean).join(' · ');
  return text || null;
}

/**
 * The newest release, featured. Like Signature Home's hero, the art keeps its own
 * landscape shape (the title is in the artwork) and fades into a panel that stays dark in
 * both themes, so it reads `darkColors` directly.
 */
function LatestReleaseCard({ sermon, unread, onPress }: { sermon: SermonListItem; unread: boolean; onPress: () => void }) {
  const when = formatWhen(sermon.publish_at);
  const chip = [isFresh(sermon.publish_at) ? 'Just released' : 'Latest release', when?.toLowerCase()]
    .filter(Boolean)
    .join(' · ');
  const meta = categoryAndLength(sermon);
  return (
    <PressableScale
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={[sermon.title, meta, unread ? 'unread' : null].filter(Boolean).join(', ')}
      style={featured.card}
    >
      <View style={featured.art}>
        {sermon.thumbnail_url ? (
          <Image source={{ uri: sermon.thumbnail_url }} style={StyleSheet.absoluteFill} resizeMode="cover" />
        ) : null}
        <View style={featured.scrim} pointerEvents="none">
          {onArt.overlay.scrimLayers.map((color) => (
            <View key={color} style={[featured.scrimBand, { backgroundColor: color }]} />
          ))}
        </View>
        <View style={featured.chip} pointerEvents="none">
          <Flame width={8} fill={unread ? onArt.accent.goldText : onArt.text.tertiary} />
          <AppText variant="ui.badge" style={featured.onArtText}>
            {chip}
          </AppText>
        </View>
      </View>
      <View style={featured.panel}>
        <View style={featured.panelText}>
          <AppText variant="display.title" style={featured.onArtText} numberOfLines={2}>
            {sermon.title}
          </AppText>
          {meta ? (
            <AppText variant="ui.body" style={featured.onArtSecondary} numberOfLines={1}>
              {meta}
            </AppText>
          ) : null}
        </View>
        <View style={featured.play} pointerEvents="none">
          <PlatformIcon name="play" size={18} color={onArt.primaryButton.text} />
        </View>
      </View>
    </PressableScale>
  );
}

function NotificationRow({ sermon, unread, onPress }: { sermon: SermonListItem; unread: boolean; onPress: () => void }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const when = formatWhen(sermon.publish_at);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={unread ? `${sermon.title}, unread` : sermon.title}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
    >
      <View style={[styles.rowArt, ROW_LEAF]}>
        {sermon.thumbnail_url ? (
          <Image source={{ uri: sermon.thumbnail_url }} style={StyleSheet.absoluteFill} resizeMode="cover" />
        ) : (
          <PlatformIcon name="musical-notes-outline" size={20} color={colors.text.tertiary} />
        )}
      </View>
      <View style={styles.rowText}>
        <AppText
          variant="ui.bodyLarge"
          tone={unread ? 'primary' : 'secondary'}
          style={unread ? styles.unreadTitle : undefined}
          numberOfLines={2}
        >
          {sermon.title}
        </AppText>
        <AppText variant="ui.body" tone="secondary" numberOfLines={1}>
          {sermon.category_name ?? ''}
          {when ? (
            <AppText variant="mono.meta" tone="tertiary">
              {sermon.category_name ? `  ·  ${when}` : when}
            </AppText>
          ) : null}
        </AppText>
      </View>
      <View style={styles.dotSlot}>{unread ? <Flame width={10} fill={colors.accent.gold} /> : null}</View>
    </Pressable>
  );
}

function Section({
  label,
  items,
  isRead,
  onOpen,
  offset,
}: {
  label: string;
  items: SermonListItem[];
  isRead: (id: string) => boolean;
  onOpen: (sermon: SermonListItem) => void;
  offset: number;
}) {
  const styles = useStyles();
  if (items.length === 0) return null;
  return (
    <View style={styles.section}>
      <AppText variant="mono.meta" tone="tertiary" accessibilityRole="header">
        {label.toUpperCase()}
      </AppText>
      <View>
        {items.map((sermon, index) => (
          <StaggerItem key={sermon.id} index={offset + index}>
            <NotificationRow sermon={sermon} unread={!isRead(sermon.id)} onPress={() => onOpen(sermon)} />
          </StaggerItem>
        ))}
      </View>
    </View>
  );
}

/**
 * Notifications, Signature redesign (Nii's approved mockup "RhemaPod — Signature",
 * 2026-10-21), behind `SIGNATURE_NOTIFICATIONS_ENABLED`. Same data and read/unread
 * tracking as the classic screen — `useNewReleases()` with `useNotificationsBadge()` —
 * laid out as the newest release featured at the top, then "New" (the rest of its first
 * week) and "Earlier". A gold flame marks an unread row; opening a sermon marks it read,
 * and "Mark all read" clears everything listed.
 */
export function SignatureNotificationsScreen() {
  const { colors } = useTheme();
  const styles = useStyles();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const newReleases = useNewReleases();
  const badge = useNotificationsBadge();
  const [refreshing, setRefreshing] = useState(false);

  const items = newReleases.data ?? [];
  const { latest, fresh, earlier } = splitNotifications(items);
  const unread = badge.unseenCount;

  const open = (sermon: SermonListItem) => {
    badge.markRead(sermon.id);
    router.push({ pathname: '/sermon/[id]', params: { id: sermon.id } });
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await newReleases.refetch();
    setRefreshing(false);
  };

  return (
    <View style={styles.screen}>
      <View style={[styles.header, { paddingTop: Math.max(insets.top, spacing.sm) }]}>
        <View style={styles.headerBar}>
          <IconButton icon="chevron-back" accessibilityLabel="Back" onPress={() => router.back()} />
          {items.length > 0 ? (
            <Pressable
              onPress={badge.markAllRead}
              disabled={unread === 0}
              accessibilityRole="button"
              accessibilityState={{ disabled: unread === 0 }}
              hitSlop={spacing.sm}
              style={styles.markAll}
            >
              <AppText variant="ui.label" tone={unread > 0 ? 'gold' : 'tertiary'}>
                Mark all read
              </AppText>
            </Pressable>
          ) : null}
        </View>
        <View style={styles.titleRow}>
          <AppText variant="display.hero" accessibilityRole="header">
            Notifications
          </AppText>
          {unread > 0 ? (
            <AppText variant="mono.meta" tone="gold">
              {unread > 9 ? '9+ NEW' : `${unread} NEW`}
            </AppText>
          ) : null}
        </View>
      </View>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.accent.gold}
            colors={[colors.accent.gold]}
          />
        }
      >
        <QueryState
          isLoading={newReleases.isLoading}
          isError={newReleases.isError}
          error={newReleases.error}
          isEmpty={!newReleases.isLoading && !newReleases.isError && items.length === 0}
          emptyTitle="Nothing new yet"
          emptyDescription="New sermons show up here as soon as they're released."
          onRetry={() => newReleases.refetch()}
          loadingLabel="Loading new releases"
        >
          <View style={styles.body}>
            {latest ? (
              <StaggerItem index={0}>
                <LatestReleaseCard sermon={latest} unread={!badge.isRead(latest.id)} onPress={() => open(latest)} />
              </StaggerItem>
            ) : null}
            <Section label="New" items={fresh} isRead={badge.isRead} onOpen={open} offset={1} />
            <Section label="Earlier" items={earlier} isRead={badge.isRead} onOpen={open} offset={1 + fresh.length} />
          </View>
        </QueryState>
      </ScrollView>
    </View>
  );
}

const useStyles = createThemedStyles((colors) => ({
  screen: {
    flex: 1,
    backgroundColor: colors.surface.app,
  },
  header: {
    paddingHorizontal: spacing.xs,
    paddingBottom: spacing.sm,
    gap: spacing.xs,
  },
  headerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  markAll: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: spacing.md - 2,
    paddingHorizontal: spacing.md,
  },
  scroll: {
    flex: 1,
  },
  content: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xxl,
  },
  body: {
    gap: spacing.xxl - spacing.xs,
  },
  section: {
    gap: spacing.xs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 72,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border.default,
  },
  rowPressed: {
    opacity: 0.7,
  },
  rowArt: {
    width: ROW_ART_WIDTH,
    aspectRatio: 16 / 9,
    overflow: 'hidden',
    backgroundColor: colors.surface.sunken,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  unreadTitle: {
    fontFamily: fontFamily.uiSemiBold,
  },
  dotSlot: {
    width: 10,
    alignItems: 'center',
  },
}));

const featured = StyleSheet.create({
  card: {
    ...LEAF,
    overflow: 'hidden',
    backgroundColor: onArt.surface.app,
  },
  art: {
    aspectRatio: 16 / 9,
    backgroundColor: onArt.surface.sunken,
  },
  scrim: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: '40%',
  },
  scrimBand: {
    flex: 1,
  },
  chip: {
    position: 'absolute',
    top: spacing.md,
    left: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs + 2,
    paddingHorizontal: spacing.md - 2,
    paddingVertical: spacing.xs + 1,
    borderRadius: radius.pill,
    backgroundColor: onArt.overlay.chipFill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: onArt.overlay.chipBorder,
  },
  panel: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xs,
    paddingBottom: spacing.lg,
  },
  panelText: {
    flex: 1,
    gap: spacing.xs,
  },
  onArtText: {
    color: onArt.text.primary,
  },
  onArtSecondary: {
    color: onArt.text.secondary,
  },
  play: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: onArt.primaryButton.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
