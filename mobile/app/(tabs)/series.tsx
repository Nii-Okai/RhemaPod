import React from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { AppText, QueryState } from '../../components';
import { colors } from '../../theme/colors';
import { spacing } from '../../theme/spacing';
import { useSeriesList } from '../../lib/query/hooks/useSeries';
import { SeriesListCard } from './_series/SeriesListCard';

/**
 * Tablet rail's Series tab (design spec §2, plan W4.4/P3) — no phone
 * equivalent by design (the rail has room the phone tab bar doesn't; phone
 * reaches series via Home's shelf and Browse instead). Minimal by design:
 * the spec draws no dedicated screen here beyond the rail slot itself, so
 * this is a flat `GET /series` list linking into `/series/[id]` (this
 * slice's other, platform-shared route).
 */
export default function SeriesScreen() {
  const router = useRouter();
  const series = useSeriesList();

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <AppText variant="display.section" style={styles.heading}>
        Series
      </AppText>
      <QueryState
        isLoading={series.isLoading}
        isError={series.isError}
        error={series.error}
        isEmpty={!series.isLoading && !series.isError && (series.data?.length ?? 0) === 0}
        emptyTitle="No series yet"
        emptyDescription="Check back once the catalogue has series."
        onRetry={() => series.refetch()}
        loadingLabel="Loading series"
      >
        {(series.data ?? []).map((item) => (
          <SeriesListCard
            key={item.id}
            series={item}
            onPress={() => router.push({ pathname: '/series/[id]', params: { id: item.id } })}
          />
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
