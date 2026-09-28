import React from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { AppText, QueryState } from '../components';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { useWatchHistory, type ProgressPublic } from '../lib/query/hooks/useWatchHistory';
import { useSermons, type SermonListItem } from '../lib/query/hooks/useSermons';
import { buildSermonTitleMap } from '../lib/format/sermonTitleMap';
import { formatDuration } from '../lib/format/duration';

/**
 * Full watch-history list (design spec 1n's Library section, P8: the "History" row is a
 * plain navigating row with no count — this screen is where the actual history lives).
 * Reuses `useWatchHistory` (`GET /me/history`, the backend's own 100-row ceiling,
 * most-recent-first — same read Series-detail's per-episode status already relies on,
 * `lib/format/episodeStatus.ts`) rather than a second, competing history read.
 */
function statusFor(entry: ProgressPublic, sermon: SermonListItem | undefined): string {
  if (entry.completed) return 'Watched';
  if (!sermon || sermon.duration_seconds === null || sermon.duration_seconds === undefined) {
    return 'In progress';
  }
  const remaining = Math.max(sermon.duration_seconds - entry.position_seconds, 0);
  return `${formatDuration(remaining)} left`;
}

export default function HistoryScreen() {
  const router = useRouter();
  const historyQuery = useWatchHistory();
  const sermonsQuery = useSermons();

  const sermonTitles = buildSermonTitleMap(sermonsQuery.data ?? []);
  const history = historyQuery.data ?? [];

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title: 'Watch history' }} />
      <QueryState
        isLoading={historyQuery.isLoading}
        isError={historyQuery.isError}
        error={historyQuery.error}
        isEmpty={!historyQuery.isLoading && !historyQuery.isError && history.length === 0}
        emptyTitle="No watch history yet"
        emptyDescription="Sermons you play will show up here."
        onRetry={() => historyQuery.refetch()}
        loadingLabel="Loading watch history"
      >
        {history.map((entry) => {
          const sermon = sermonTitles.get(entry.sermon_id);
          const title = sermon?.title ?? 'Sermon';
          const status = statusFor(entry, sermon);
          return (
            <Pressable
              key={entry.sermon_id}
              accessibilityRole="button"
              accessibilityLabel={`${title}, ${status}`}
              onPress={() => router.push({ pathname: '/sermon/[id]', params: { id: entry.sermon_id } })}
              style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
            >
              <View style={styles.textBlock}>
                <AppText variant="display.compact" numberOfLines={2}>
                  {title}
                </AppText>
                <AppText variant="mono.meta" tone="tertiary">
                  {status}
                </AppText>
              </View>
            </Pressable>
          );
        })}
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
  row: {
    paddingVertical: spacing.md,
  },
  rowPressed: {
    opacity: 0.7,
  },
  textBlock: {
    gap: spacing.xs,
  },
});
