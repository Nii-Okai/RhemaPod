import React, { useMemo } from 'react';
import { Image, ScrollView, StyleSheet } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { AppText, QueryState } from '../../components';
import { EpisodeRow } from '../../components/series/EpisodeRow';
import { colors } from '../../theme/colors';
import { radius } from '../../theme/radius';
import { spacing } from '../../theme/spacing';
import { useSeriesDetail, useSeriesEpisodes } from '../../lib/query/hooks/useSeries';
import { useWatchHistory } from '../../lib/query/hooks/useWatchHistory';
import { buildHistoryMap, deriveEpisodeStatus } from '../../lib/format/episodeStatus';

/**
 * Series detail (design spec 1h, plan W4.4) — a top-level stack route
 * (plan L15/§A.7): one route, identical on every platform, registered in
 * `app/_layout.tsx` next to `sermon/[id]`, `category/[id]`, `speaker/[id]`.
 * Reached from Home's Series shelf (W4.1), Browse (W4.3), and this slice's
 * own tablet Series rail tab (`(tabs)/series.tsx`).
 *
 * Episode numbers come straight from `GET /series/{id}/episodes`, which is
 * already renumbered to a contiguous 1..N sequence server-side (plan
 * L11/W2.3, `content_service.renumber_for_display`) — this screen never
 * renumbers, sorts, or hides a row itself; an unnumbered episode
 * (`episode_number: null`) renders with no number, never a placeholder
 * digit. Per-episode status ("watched" / "17:04 left" / "new") is derived
 * from one `GET /me/history?series_id=<id>` call, not a fetch per episode —
 * see `lib/format/episodeStatus.ts`. Scoped to this series (Decision 6)
 * rather than the app-wide capped read, so status stays accurate
 * regardless of episode count — an old watch on a long-running series no
 * longer falls off a 100-row app-wide cap and misreads as "new". If that
 * call fails, episodes render with no status label at all rather than
 * fabricating "new" for everything (a `/me/history` 500 must not read as
 * "you haven't watched any of this"); the primary series/episode content
 * still renders and errors normally.
 */
export default function SeriesDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const series = useSeriesDetail(id);
  const episodes = useSeriesEpisodes(id);
  const history = useWatchHistory(id);

  const historyMap = useMemo(() => buildHistoryMap(history.data ?? []), [history.data]);

  return (
    <>
      <Stack.Screen options={{ title: series.data?.title ?? '' }} />
      <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
        <QueryState
          isLoading={series.isLoading}
          isError={series.isError}
          error={series.error}
          isEmpty={false}
          emptyTitle=""
          onRetry={() => series.refetch()}
          loadingLabel="Loading series"
        >
          {series.data ? (
            <>
              {series.data.thumbnail_url ? (
                <Image source={{ uri: series.data.thumbnail_url }} style={styles.art} />
              ) : null}
              <AppText variant="display.title" style={styles.title}>
                {series.data.title}
              </AppText>
              {series.data.description ? (
                <AppText variant="ui.body" tone="secondary" style={styles.synopsis}>
                  {series.data.description}
                </AppText>
              ) : null}
              <QueryState
                isLoading={episodes.isLoading}
                isError={episodes.isError}
                error={episodes.error}
                isEmpty={!episodes.isLoading && !episodes.isError && (episodes.data?.length ?? 0) === 0}
                emptyTitle="No episodes yet"
                emptyDescription="Check back once this series has published episodes."
                onRetry={() => episodes.refetch()}
                loadingLabel="Loading episodes"
              >
                {(episodes.data ?? []).map((episode) => (
                  <EpisodeRow
                    key={episode.id}
                    episode={episode}
                    status={history.isError ? null : deriveEpisodeStatus(episode, historyMap)}
                    onPress={() => router.push({ pathname: '/sermon/[id]', params: { id: episode.id } })}
                  />
                ))}
              </QueryState>
            </>
          ) : null}
        </QueryState>
      </ScrollView>
    </>
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
  art: {
    width: '100%',
    aspectRatio: 16 / 9,
    borderRadius: radius.lg,
    marginBottom: spacing.lg,
  },
  title: {
    marginBottom: spacing.sm,
  },
  synopsis: {
    marginBottom: spacing.xl,
  },
});
