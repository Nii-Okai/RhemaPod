import React, { useState } from 'react';
import { Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText, CircleButton, FittedArt, QueryState, RowPill } from '../../components';
import { createThemedStyles } from '../../theme/ThemeContext';
import { spacing } from '../../theme/spacing';
import { useSeriesList, type SeriesPublic } from '../../lib/query/hooks/useSeries';
import { useContinueWatching } from '../../lib/query/hooks/useContinueWatching';
import { useDeviceClass } from '../../components/navigation/useDeviceClass';
import { usePullToRefresh } from '../../lib/hooks/usePullToRefresh';

/**
 * Daybreak redesign (canvas B7): a round back button (phones), a Fraunces "Series"
 * title with a line under it, All / In progress chips, then each series as a card with
 * tall art. A series you've started (from Continue watching) wears an "In progress" pill
 * and a progress line with the episode you're on.
 *
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
 *
 * The cards are a `FlashList`, so a long catalogue scrolls without keeping every card
 * (and its artwork) mounted at once.
 */
const LIST_GAP = spacing.md + 2;

export default function SeriesScreen() {
  const styles = useStyles();
  const router = useRouter();
  const series = useSeriesList();
  const continueWatching = useContinueWatching();
  const pullToRefresh = usePullToRefresh([series]);
  const insets = useSafeAreaInsets();
  const isTablet = useDeviceClass() === 'tablet';
  const [filter, setFilter] = useState<'all' | 'progress'>('all');

  // The episode you're on in each series you've started, from Continue watching.
  const onEpisode = new Map<string, number>();
  for (const item of Array.isArray(continueWatching.data) ? continueWatching.data : []) {
    if (item.series_id && item.episode_number && !onEpisode.has(item.series_id)) {
      onEpisode.set(item.series_id, item.episode_number);
    }
  }
  const all = series.data ?? [];
  const inProgress = all.filter((item) => onEpisode.has(item.id));
  const shown = filter === 'progress' ? inProgress : all;

  const header = (
    <View style={styles.headerBlock}>
      <View style={styles.titles}>
        {/* Back sits on the title's row (Nii, 2026-11-11). */}
        <View style={styles.backRow}>
          {isTablet ? null : (
            <CircleButton icon="chevron-back" accessibilityLabel="Back" onPress={() => router.back()} />
          )}
          <AppText variant="display.hero" accessibilityRole="header">
            Series
          </AppText>
        </View>
        <AppText variant="ui.body" tone="secondary">
          Teaching that builds week by week. Start one and we'll keep your place.
        </AppText>
      </View>

      {all.length > 0 ? (
        <View style={styles.chips}>
          <Chip label={`All · ${all.length}`} on={filter === 'all'} onPress={() => setFilter('all')} />
          {inProgress.length > 0 ? (
            <Chip label={`In progress · ${inProgress.length}`} on={filter === 'progress'} onPress={() => setFilter('progress')} />
          ) : null}
        </View>
      ) : null}
    </View>
  );

  return (
    <View style={styles.screen}>
      <FlashList
        data={shown}
        // Progress comes from a separate query; re-render the cards when it lands.
        extraData={onEpisode}
        keyExtractor={(item) => item.id}
        estimatedItemSize={146 + LIST_GAP}
        renderItem={({ item }) => (
          <View style={styles.cell}>
            <SeriesRowCard
              series={item}
              onEpisode={onEpisode.get(item.id) ?? null}
              onPress={() => router.push({ pathname: '/series/[id]', params: { id: item.id } })}
            />
          </View>
        )}
        ListHeaderComponent={header}
        ListEmptyComponent={
          <QueryState
            isLoading={series.isLoading}
            isError={series.isError}
            error={series.error}
            isEmpty={!series.isLoading && !series.isError && all.length === 0}
            emptyTitle="No series yet"
            emptyDescription="Check back once the catalogue has series."
            onRetry={() => series.refetch()}
            loadingLabel="Loading series"
          >
            {null}
          </QueryState>
        }
        contentContainerStyle={{ ...styles.content, paddingTop: Math.max(insets.top, spacing.sm) + spacing.sm }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl {...pullToRefresh} />}
      />
    </View>
  );
}

function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  const styles = useStyles();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      style={[styles.chip, on && styles.chipOn]}
    >
      <AppText variant="ui.label" style={on ? styles.chipTextOn : styles.chipText}>
        {label}
      </AppText>
    </Pressable>
  );
}

function episodes(count: number): string {
  return count === 1 ? '1 episode' : `${count} episodes`;
}

/** One series (canvas B7): tall art, an "In progress" pill and progress when started. */
function SeriesRowCard({
  series,
  onEpisode,
  onPress,
}: {
  series: SeriesPublic;
  onEpisode: number | null;
  onPress: () => void;
}) {
  const styles = useStyles();
  const fraction = onEpisode && series.episode_count ? Math.min(1, onEpisode / series.episode_count) : 0;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${series.title}, ${episodes(series.episode_count)}${onEpisode ? `, on episode ${onEpisode}` : ''}`}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <View style={styles.art}>{series.thumbnail_url ? <FittedArt uri={series.thumbnail_url} /> : null}</View>
      <View style={styles.cardText}>
        {onEpisode ? <RowPill label="In progress" tone="iris" /> : null}
        <AppText variant="display.row" numberOfLines={3}>
          {series.title}
        </AppText>
        <AppText variant="ui.badge" tone="tertiary">
          {episodes(series.episode_count)}
        </AppText>
        {onEpisode ? (
          <View style={styles.progressRow}>
            <View style={styles.track}>
              <View style={[styles.fill, { width: `${fraction * 100}%` }]} />
            </View>
            <AppText variant="ui.badge" tone="tertiary">
              {`${onEpisode} of ${series.episode_count}`}
            </AppText>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

const useStyles = createThemedStyles((colors) => ({
  screen: {
    flex: 1,
    backgroundColor: colors.surface.app,
  },
  content: {
    paddingHorizontal: spacing.lg + 4,
    paddingBottom: spacing.xxl * 2,
  },
  headerBlock: {
    gap: spacing.lg,
    paddingBottom: spacing.lg,
  },
  backRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  titles: {
    gap: spacing.xs + 2,
    paddingTop: spacing.sm,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  chip: {
    height: 36,
    borderRadius: 18,
    paddingHorizontal: spacing.md + 2,
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border.default,
    backgroundColor: colors.surface.raised,
  },
  chipOn: {
    backgroundColor: colors.text.primary,
    borderColor: colors.text.primary,
  },
  chipText: {
    color: colors.text.secondary,
  },
  chipTextOn: {
    color: colors.surface.app,
  },
  cell: {
    paddingBottom: LIST_GAP,
  },
  card: {
    flexDirection: 'row',
    gap: spacing.md + 2,
    padding: spacing.md,
    borderRadius: 24,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border.default,
    backgroundColor: colors.surface.raised,
  },
  pressed: {
    opacity: 0.8,
  },
  art: {
    width: 96,
    height: 120,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: colors.surface.sunken,
  },
  cardText: {
    flex: 1,
    gap: 6,
    paddingVertical: 4,
  },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: 'auto',
  },
  track: {
    flex: 1,
    height: 4,
    borderRadius: 2,
    overflow: 'hidden',
    backgroundColor: colors.track.default,
  },
  fill: {
    height: 4,
    backgroundColor: colors.accent.gold,
  },
}));
