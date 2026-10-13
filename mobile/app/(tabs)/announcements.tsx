import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText, IconButton, QueryState } from '../../components';
import { AnnouncementCard } from '../../components/announcements/AnnouncementCard';
import { colors } from '../../theme/colors';
import { spacing } from '../../theme/spacing';
import { useAnnouncements } from '../../lib/query/hooks/useAnnouncements';
import { sortPinnedFirst } from '../../lib/format/pinnedFirst';
import { useDeviceClass } from '../../components/navigation/useDeviceClass';

/**
 * Announcements (design spec 1k, plan W4.4) — the tablet rail's dedicated
 * slot (P3) and the destination phone reaches via Home's announcements
 * card/row and Me's Announcements row (P2, both owned by W4.1/W4.6, not
 * this file). `GET /announcements` already windows on
 * `publish_at`/`expires_at` server-side (`announcement_service.list_visible`'s
 * own docstring: "nothing sits in the list that shouldn't be visible") —
 * this screen applies no client-side date filtering, only a defensive
 * pinned-first re-sort (`sortPinnedFirst`) on top of whatever order the
 * server returns.
 *
 * Back-chevron header on phone, same conditional-on-device-class pattern
 * `series.tsx`'s own phone header established (Isaac's ask, session
 * 2026-10-11: "apply preestablish style") — this screen had no way back at
 * all on phone before (no back button, no tab-bar entry, nothing but the OS
 * swipe gesture), unlike every other screen reached by a push. Hidden on
 * tablet, where the persistent rail is itself the way back to Home — a back
 * arrow there would be redundant chrome next to chrome that never moves,
 * same reasoning `series.tsx`'s own doc comment gives.
 */
export default function AnnouncementsScreen() {
  const router = useRouter();
  const announcements = useAnnouncements();
  const items = sortPinnedFirst(announcements.data ?? []);
  const isTablet = useDeviceClass() === 'tablet';
  const insets = useSafeAreaInsets();

  return (
    <View style={styles.screen}>
      {isTablet ? null : (
        <View style={[styles.header, { paddingTop: Math.max(insets.top, spacing.sm) }]}>
          <IconButton icon="chevron-back" accessibilityLabel="Back" onPress={() => router.back()} />
          <AppText variant="ui.bodyLarge" style={styles.headerTitle}>
            Announcements
          </AppText>
          <View style={styles.headerSpacer} />
        </View>
      )}
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {isTablet ? (
          <AppText variant="display.section" style={styles.heading}>
            Announcements
          </AppText>
        ) : null}
        <QueryState
          isLoading={announcements.isLoading}
          isError={announcements.isError}
          error={announcements.error}
          isEmpty={!announcements.isLoading && !announcements.isError && items.length === 0}
          emptyTitle="No announcements right now"
          emptyDescription="Check back soon."
          onRetry={() => announcements.refetch()}
          loadingLabel="Loading announcements"
        >
          {items.map((announcement) => (
            <AnnouncementCard key={announcement.id} announcement={announcement} />
          ))}
        </QueryState>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.surface.app,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.xs,
    paddingBottom: spacing.sm,
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
  },
  // Balances the back button's width so the centered title is actually centered.
  headerSpacer: {
    width: 44,
  },
  scroll: {
    flex: 1,
  },
  content: {
    padding: spacing.lg,
    paddingBottom: spacing.xxl * 2,
  },
  heading: {
    marginBottom: spacing.lg,
  },
});
