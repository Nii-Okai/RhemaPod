import React from 'react';
import { ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText, IconButton, QueryState } from '../../components';
import { SermonCard } from '../../components/sermon/SermonCard';
import { colors } from '../../theme/colors';
import { spacing } from '../../theme/spacing';
import { useSearchResults } from '../../lib/query/hooks/useSearch';

const GRID_COLUMNS = 2;
const GRID_GAP = spacing.md;
const GRID_PADDING = spacing.lg;

/**
 * Category drill-down list — reached by tapping a category card on Browse.
 * No screen is drawn for this destination in the design spec (only the
 * Browse card that links to it), so this reuses `/search` as a filtered
 * browse (`category_id`, no `q` — the endpoint's own documented mode).
 *
 * Renders a 2-column grid of `SermonCard` (Isaac's ask, session 2026-10-02: "follow the
 * same style as all series page") rather than the text-row `SermonResultRow` the Search
 * tab uses — `SermonCard` is the card used elsewhere for "same visual language as
 * SeriesCard" (its own doc comment), which is the actual card look the all-series page's
 * own `SeriesListCard` shares. Grid width is computed from `useWindowDimensions()`, same
 * convention `RelatedSermons`' own grid mode and Browse's categories grid use — RN's
 * `gap` doesn't subtract itself out of a percentage width. `showMeta={false}` drops each
 * card's speaker-name line (Isaac's follow-up ask, same session) — the accessibility
 * label still carries it, same convention `SermonCard`'s own `showMeta` doc comment
 * describes for New Releases.
 *
 * Custom back-chevron + centered-title header (Isaac's ask, same session: "same
 * navigation style as all series page") — same layout `series.tsx`'s own phone header
 * uses, in place of the native Stack header (`app/_layout.tsx` disables it for this
 * route) which would otherwise show "< Browse" next to the chevron on iOS rather than a
 * bare chevron.
 */
export default function CategoryDrillDownScreen() {
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const results = useSearchResults({ category_id: id });
  const { width: windowWidth } = useWindowDimensions();
  const cardWidth = (windowWidth - GRID_PADDING * 2 - GRID_GAP * (GRID_COLUMNS - 1)) / GRID_COLUMNS;

  return (
    <View style={styles.screen}>
      <View style={[styles.header, { paddingTop: Math.max(insets.top, spacing.sm) }]}>
        <IconButton icon="chevron-back" accessibilityLabel="Back" onPress={() => router.back()} />
        <AppText variant="ui.bodyLarge" style={styles.headerTitle}>
          {name || 'Category'}
        </AppText>
        <View style={styles.headerSpacer} />
      </View>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <QueryState
          isLoading={results.isLoading}
          isError={results.isError}
          error={results.error}
          isEmpty={!results.isLoading && !results.isError && (results.data?.results.length ?? 0) === 0}
          emptyTitle="No sermons yet"
          emptyDescription={name ? `Nothing published under “${name}” yet.` : undefined}
          onRetry={() => results.refetch()}
          loadingLabel="Loading sermons"
        >
          <View style={styles.grid}>
            {(results.data?.results ?? []).map((sermon) => (
              <SermonCard
                key={sermon.id}
                sermon={sermon}
                width={cardWidth}
                showMeta={false}
                onPress={() => router.push({ pathname: '/sermon/[id]', params: { id: sermon.id } })}
              />
            ))}
          </View>
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
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: GRID_GAP,
  },
});
