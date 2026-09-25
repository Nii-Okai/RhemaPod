import React from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { AppText, QueryState } from '../../components';
import { AnnouncementCard } from '../../components/announcements/AnnouncementCard';
import { colors } from '../../theme/colors';
import { spacing } from '../../theme/spacing';
import { useAnnouncements } from '../../lib/query/hooks/useAnnouncements';
import { sortPinnedFirst } from '../../lib/format/pinnedFirst';

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
 */
export default function AnnouncementsScreen() {
  const announcements = useAnnouncements();
  const items = sortPinnedFirst(announcements.data ?? []);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <AppText variant="display.section" style={styles.heading}>
        Announcements
      </AppText>
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
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.surface.app,
  },
  content: {
    padding: spacing.lg,
    paddingBottom: spacing.xxl * 2,
  },
  heading: {
    marginBottom: spacing.lg,
  },
});
