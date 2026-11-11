import React from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText, CircleButton, FittedArt, PlatformIcon, QueryState, StaggerItem } from '../../components';
import { createThemedStyles, useTheme } from '../../theme/ThemeContext';
import { spacing } from '../../theme/spacing';
import { useNewReleases } from '../../lib/query/hooks/useNewReleases';
import { useNotificationsBadge } from '../../lib/query/hooks/useNotificationsBadge';
import type { SermonListItem } from '../../lib/query/hooks/useSermons';
import { formatWhen, isFresh, splitNotifications } from './notificationTime';
import { usePullToRefresh } from '../../lib/hooks/usePullToRefresh';

/**
 * One notification (canvas B9). Unread ones are white cards with a gold dot; read and
 * older ones are plain rows on the page. "New sermon:" leads the line, in bold.
 */
function NotificationRow({
  sermon,
  unread,
  card,
  onPress,
}: {
  sermon: SermonListItem;
  unread: boolean;
  card: boolean;
  onPress: () => void;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const when = formatWhen(sermon.publish_at);
  const meta = [when, sermon.category_name].filter(Boolean).join(' · ');
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={unread ? `${sermon.title}, unread` : sermon.title}
      style={({ pressed }) => [card ? styles.card : styles.row, pressed && styles.rowPressed]}
    >
      <View style={[styles.rowArt, card ? styles.cardArt : null]}>
        {sermon.thumbnail_url ? (
          <FittedArt uri={sermon.thumbnail_url} />
        ) : (
          <PlatformIcon name="musical-notes-outline" size={20} color={colors.text.tertiary} />
        )}
      </View>
      <View style={styles.rowText}>
        <AppText variant="ui.body" tone={unread ? 'primary' : 'secondary'} numberOfLines={2}>
          <AppText variant="ui.bodyBold" tone={unread ? 'primary' : 'secondary'}>
            {'New sermon: '}
          </AppText>
          {sermon.title}
        </AppText>
        {meta ? (
          <AppText variant="ui.badge" tone="tertiary" numberOfLines={1}>
            {meta}
          </AppText>
        ) : null}
      </View>
      <View style={styles.dotSlot}>{unread ? <View style={styles.dot} /> : null}</View>
    </Pressable>
  );
}

function Section({
  label,
  items,
  isRead,
  onOpen,
  offset,
  cards,
}: {
  label: string;
  items: SermonListItem[];
  isRead: (id: string) => boolean;
  onOpen: (sermon: SermonListItem) => void;
  offset: number;
  cards: boolean;
}) {
  const styles = useStyles();
  if (items.length === 0) return null;
  return (
    <View style={styles.section}>
      <AppText variant="ui.badge" tone="tertiary" accessibilityRole="header" style={styles.eyebrow}>
        {label.toUpperCase()}
      </AppText>
      <View style={cards ? styles.cardList : null}>
        {items.map((sermon, index) => (
          <StaggerItem key={sermon.id} index={offset + index}>
            <NotificationRow
              sermon={sermon}
              unread={!isRead(sermon.id)}
              card={cards}
              onPress={() => onOpen(sermon)}
            />
          </StaggerItem>
        ))}
      </View>
    </View>
  );
}

/**
 * Daybreak redesign (canvas B9): round back button and "Mark all read", the title with
 * a gold count of unread, then "New" as white cards with a gold dot for unread and
 * "Earlier" as plain rows. The featured release card is gone; the newest release simply
 * leads the New list.
 *
 * Notifications, Signature redesign (Nii's approved mockup "RhemaPod — Signature",
 * 2026-10-21), behind `SIGNATURE_NOTIFICATIONS_ENABLED`. Same data and read/unread
 * tracking as the classic screen — `useNewReleases()` with `useNotificationsBadge()` —
 * laid out as the newest release featured at the top, then "New" (the rest of its first
 * week) and "Earlier". A gold flame marks an unread row; opening a sermon marks it read,
 * and "Mark all read" clears everything listed.
 */
export function SignatureNotificationsScreen() {
  const styles = useStyles();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const newReleases = useNewReleases();
  const badge = useNotificationsBadge();

  const items = newReleases.data ?? [];
  const { latest, fresh, earlier } = splitNotifications(items);
  const unread = badge.unseenCount;
  // The newest release leads "New" while it's still in its first week, else "Earlier".
  const latestIsFresh = latest ? isFresh(latest.publish_at) : false;
  const newItems = latest && latestIsFresh ? [latest, ...fresh] : fresh;
  const earlierItems = latest && !latestIsFresh ? [latest, ...earlier] : earlier;

  const open = (sermon: SermonListItem) => {
    badge.markRead(sermon.id);
    router.push({ pathname: '/player/[id]', params: { id: sermon.id } });
  };

  const pullToRefresh = usePullToRefresh([newReleases]);

  return (
    <View style={styles.screen}>
      <View style={[styles.header, { paddingTop: Math.max(insets.top, spacing.sm) + spacing.sm }]}>
        <View style={styles.headerBar}>
          <CircleButton icon="chevron-back" accessibilityLabel="Back" onPress={() => router.back()} />
          {items.length > 0 ? (
            <Pressable
              onPress={badge.markAllRead}
              disabled={unread === 0}
              accessibilityRole="button"
              accessibilityState={{ disabled: unread === 0 }}
              hitSlop={spacing.sm}
              style={styles.markAll}
            >
              <AppText variant="ui.bodyBold" tone={unread > 0 ? 'gold' : 'tertiary'}>
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
            <View style={styles.newPill}>
              <AppText variant="ui.badge" style={styles.newPillText}>
                {unread > 9 ? '9+ NEW' : `${unread} NEW`}
              </AppText>
            </View>
          ) : null}
        </View>
      </View>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl {...pullToRefresh} />
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
            <Section label="New" items={newItems} isRead={badge.isRead} onOpen={open} offset={0} cards />
            <Section
              label="Earlier"
              items={earlierItems}
              isRead={badge.isRead}
              onOpen={open}
              offset={newItems.length}
              cards={false}
            />
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
    paddingHorizontal: spacing.lg + 4,
    paddingBottom: spacing.sm,
    gap: spacing.lg,
  },
  headerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  markAll: {
    minHeight: 44,
    justifyContent: 'center',
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  newPill: {
    height: 24,
    paddingHorizontal: spacing.sm + 2,
    borderRadius: 12,
    justifyContent: 'center',
    backgroundColor: colors.sunButton.bg,
  },
  newPillText: {
    color: colors.sunButton.text,
    letterSpacing: 0.6,
  },
  scroll: {
    flex: 1,
  },
  content: {
    paddingHorizontal: spacing.lg + 4,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  body: {
    gap: spacing.xl,
  },
  section: {
    gap: spacing.sm + 2,
  },
  eyebrow: {
    letterSpacing: 1.5,
  },
  cardList: {
    gap: spacing.sm + 2,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md + 2,
    padding: spacing.md + 2,
    borderRadius: 24,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border.default,
    backgroundColor: colors.surface.raised,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md + 2,
    paddingVertical: spacing.sm + 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border.default,
  },
  rowPressed: {
    opacity: 0.7,
  },
  rowArt: {
    width: 44,
    height: 44,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: colors.surface.sunken,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardArt: {
    width: 52,
    height: 52,
    borderRadius: 14,
  },
  rowText: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  dotSlot: {
    width: 10,
    alignItems: 'center',
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.sunButton.bg,
  },
}));
