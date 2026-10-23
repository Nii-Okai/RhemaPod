import React from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText, IconButton, QueryState, SeriesListCard } from '../../components';
import { createThemedStyles } from '../../theme/ThemeContext';
import { spacing } from '../../theme/spacing';
import { useSeriesList } from '../../lib/query/hooks/useSeries';
import { useDeviceClass } from '../../components/navigation/useDeviceClass';
import { usePullToRefresh } from '../../lib/hooks/usePullToRefresh';

/**
 * Tablet rail's Series tab (design spec §2, plan W4.4/P3) — reachable on the rail as a
 * persistent nav item there, and (since W4.1's Home now links "See all series" here too)
 * also phone-reachable at the exact same `/series` pathname via a normal stack push. No
 * dedicated screen was drawn in the source for this beyond the rail slot itself, so this
 * stays a flat `GET /series` list linking into `/series/[id]` (this slice's other,
 * platform-shared route) either way.
 *
 * The back header only renders on phone. On tablet the persistent rail is itself the way
 * back to Home (this is one of the rail's own destinations, not something pushed on top
 * of it) — a back arrow there would be redundant chrome next to chrome that never moves.
 */
export default function SeriesScreen() {
  const styles = useStyles();
  const router = useRouter();
  const series = useSeriesList();
  const pullToRefresh = usePullToRefresh([series]);
  const insets = useSafeAreaInsets();
  const isTablet = useDeviceClass() === 'tablet';

  return (
    <View style={styles.screen}>
      {isTablet ? null : (
        <View style={[styles.header, { paddingTop: Math.max(insets.top, spacing.sm) }]}>
          <IconButton icon="chevron-back" accessibilityLabel="Back" onPress={() => router.back()} />
          <AppText variant="ui.bodyLarge" style={styles.headerTitle}>
            Series
          </AppText>
          <View style={styles.headerSpacer} />
        </View>
      )}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl {...pullToRefresh} />}
      >
        {isTablet ? (
          <AppText variant="display.section" style={styles.heading}>
            Series
          </AppText>
        ) : null}
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
}));
