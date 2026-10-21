import React from 'react';
import { Image, Pressable, ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText, IconButton, PlatformIcon, QueryState } from '../components';
import { createThemedStyles, useTheme } from '../theme/ThemeContext';
import { radius } from '../theme/radius';
import { spacing } from '../theme/spacing';
import { formatRelativeTime } from '../lib/format/relativeTime';
import { groupByRecency } from '../lib/format/notificationGroups';
import { useNewReleases } from '../lib/query/hooks/useNewReleases';
import { useNotificationsBadge } from '../lib/query/hooks/useNotificationsBadge';
import type { SermonListItem } from '../lib/query/hooks/useSermons';

const THUMBNAIL_SIZE = 56;

/**
 * Notifications (Isaac's ask, session 2026-10-11: "Notification icon should open
 * notifications page showing new releases") — `HomeTopBar`'s bell used to push straight
 * to `/announcements`; that's still reachable from the You tab's own Announcements row,
 * but the bell's own destination is this screen now, listing the same `useNewReleases()`
 * data Home's own "New Releases" shelf shows (`GET /catalog/sermons/new-releases`) —
 * there's no separate "notifications" concept or backend feed behind this, just a
 * dedicated full-list view of the same new-release sermons with a read/unread treatment
 * on top.
 *
 * Grouped by recency — Today / This week / Earlier (Isaac's own YouTube Notifications
 * screenshot as the reference, session 2026-10-10 — reused again here per Isaac's
 * follow-up, session 2026-10-11: "Notification page looks basic, organise it better").
 * `groupByRecency`'s own doc comment covers the bucketing rule.
 *
 * Read/unread is per row now, not a one-shot "mark everything seen on open" (Isaac's
 * ask, same follow-up: "counter should respect read and unread items") — a small gold
 * dot marks an unread row, cleared the moment that specific sermon is actually opened
 * (`useNotificationsBadge`'s own `markRead`), not just by having the list on screen.
 */
export default function NotificationsScreen() {
  const { colors } = useTheme();
  const styles = useStyles();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const newReleases = useNewReleases();
  const badge = useNotificationsBadge();

  const goToSermon = (sermon: SermonListItem) => {
    badge.markRead(sermon.id);
    router.push({ pathname: '/sermon/[id]', params: { id: sermon.id } });
  };

  const groups = groupByRecency(newReleases.data ?? []);

  return (
    <View style={styles.screen}>
      <View style={[styles.header, { paddingTop: Math.max(insets.top, spacing.sm) }]}>
        <IconButton icon="chevron-back" accessibilityLabel="Back" onPress={() => router.back()} />
        <AppText variant="ui.bodyLarge" style={styles.headerTitle}>
          Notifications
        </AppText>
        <View style={styles.headerSpacer} />
      </View>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <QueryState
          isLoading={newReleases.isLoading}
          isError={newReleases.isError}
          error={newReleases.error}
          isEmpty={!newReleases.isLoading && !newReleases.isError && (newReleases.data?.length ?? 0) === 0}
          emptyTitle="Nothing new yet"
          emptyDescription="New sermons show up here as soon as they're released."
          onRetry={() => newReleases.refetch()}
          loadingLabel="Loading new releases"
        >
          <View style={styles.groups}>
            {groups.map((group) => (
              <View key={group.title} style={styles.group}>
                <AppText variant="ui.label" tone="secondary" style={styles.groupLabel}>
                  {group.title}
                </AppText>
                <View style={styles.list}>
                  {group.items.map((sermon) => {
                    const unread = !badge.isRead(sermon.id);
                    const metaParts = [sermon.category_name, sermon.publish_at ? formatRelativeTime(sermon.publish_at) : null].filter(
                      (part): part is string => Boolean(part),
                    );
                    return (
                      <Pressable
                        key={sermon.id}
                        onPress={() => goToSermon(sermon)}
                        accessibilityRole="button"
                        accessibilityLabel={unread ? `${sermon.title}, unread` : sermon.title}
                        style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
                      >
                        <View style={styles.unreadDotWrap}>
                          {unread ? <View style={styles.unreadDot} /> : null}
                        </View>
                        {sermon.thumbnail_url ? (
                          <Image source={{ uri: sermon.thumbnail_url }} style={styles.thumbnail} resizeMode="cover" />
                        ) : (
                          <View style={styles.thumbnailFallback}>
                            <PlatformIcon name="musical-notes-outline" size={22} color={colors.text.tertiary} />
                          </View>
                        )}
                        <View style={styles.rowText}>
                          <AppText variant="ui.bodyLarge" tone={unread ? 'primary' : 'secondary'} numberOfLines={2}>
                            {sermon.title}
                          </AppText>
                          {metaParts.length > 0 ? (
                            <AppText variant="ui.body" tone="tertiary" numberOfLines={1}>
                              {metaParts.join(' · ')}
                            </AppText>
                          ) : null}
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            ))}
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
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.xs,
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
  },
  headerSpacer: {
    width: 44,
  },
  scroll: {
    flex: 1,
  },
  content: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  groups: {
    gap: spacing.xl,
  },
  group: {
    gap: spacing.sm,
  },
  groupLabel: {
    textTransform: 'uppercase',
  },
  list: {
    gap: spacing.xs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  rowPressed: {
    opacity: 0.7,
  },
  unreadDotWrap: {
    width: 8,
    alignItems: 'center',
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.accent.gold,
  },
  thumbnail: {
    width: THUMBNAIL_SIZE,
    height: THUMBNAIL_SIZE,
    borderRadius: radius.sm,
  },
  thumbnailFallback: {
    width: THUMBNAIL_SIZE,
    height: THUMBNAIL_SIZE,
    borderRadius: radius.sm,
    backgroundColor: colors.surface.sunken,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: {
    flex: 1,
    gap: 2,
  },
}));
