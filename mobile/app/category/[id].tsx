import React, { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, useWindowDimensions, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText, CircleButton, PlatformIcon, QueryState } from '../../components';
import { SermonCard } from '../../components/sermon/SermonCard';
import { createThemedStyles, useTheme } from '../../theme/ThemeContext';
import { spacing } from '../../theme/spacing';
import { useSearchResults } from '../../lib/query/hooks/useSearch';
import { usePullToRefresh } from '../../lib/hooks/usePullToRefresh';

const GRID_COLUMNS = 2;
const GRID_GAP = spacing.md;
const GRID_PADDING = spacing.lg + 4;

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
 * Daybreak redesign (canvas B5): the header is a soft blue wash with the topic's name
 * large, its sermon count, Play all (starts the first sermon) and a Newest/Oldest order
 * switch; the round back button sits on the wash.
 *
 * Earlier: custom back-chevron + centered-title header (Isaac's ask, same session: "same
 * navigation style as all series page") — same layout `series.tsx`'s own phone header
 * uses, in place of the native Stack header (`app/_layout.tsx` disables it for this
 * route) which would otherwise show "< Browse" next to the chevron on iOS rather than a
 * bare chevron.
 */
export default function CategoryDrillDownScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const results = useSearchResults({ category_id: id });
  const pullToRefresh = usePullToRefresh([results]);
  const { width: windowWidth } = useWindowDimensions();
  const cardWidth = (windowWidth - GRID_PADDING * 2 - GRID_GAP * (GRID_COLUMNS - 1)) / GRID_COLUMNS;
  const [oldestFirst, setOldestFirst] = useState(false);
  const all = results.data?.results ?? [];
  const sermons = oldestFirst ? [...all].reverse() : all;
  const total = results.data?.total ?? all.length;

  return (
    <View style={styles.screen}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl {...pullToRefresh} />}
      >
        {/* The topic's blue wash (canvas B5): back, eyebrow, the name large, a count,
            and Play all / sort order. */}
        <View style={[styles.hero, { paddingTop: Math.max(insets.top, spacing.sm) + spacing.sm }]}>
          <View style={styles.orbBig} pointerEvents="none" />
          <View style={styles.orbSun} pointerEvents="none" />
          <CircleButton icon="chevron-back" accessibilityLabel="Back" onPress={() => router.back()} />
          <View style={styles.heroText}>
            <AppText variant="ui.badge" style={styles.eyebrow}>
              TOPIC
            </AppText>
            <AppText variant="display.hero" accessibilityRole="header" numberOfLines={2} style={styles.title}>
              {name || 'Category'}
            </AppText>
            {results.data ? (
              <AppText variant="ui.label" style={styles.count}>
                {total === 1 ? '1 sermon' : `${total} sermons`}
              </AppText>
            ) : null}
          </View>
          {sermons.length > 0 ? (
            <View style={styles.actions}>
              <Pressable
                accessibilityRole="button"
                onPress={() => router.push({ pathname: '/player/[id]', params: { id: sermons[0].id } })}
                style={({ pressed }) => [styles.playAll, pressed && styles.pressed]}
              >
                <PlatformIcon name="play" size={18} color={colors.primaryButton.text} />
                <AppText variant="ui.button" tone="inverse">
                  Play all
                </AppText>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={oldestFirst ? 'Showing oldest first. Show newest first.' : 'Showing newest first. Show oldest first.'}
                onPress={() => setOldestFirst((v) => !v)}
                style={({ pressed }) => [styles.sort, pressed && styles.pressed]}
              >
                <PlatformIcon name="swap-vertical" size={18} color={colors.text.primary} />
                <AppText variant="ui.button">{oldestFirst ? 'Oldest' : 'Newest'}</AppText>
              </Pressable>
            </View>
          ) : null}
        </View>

        <View style={styles.body}>
          <QueryState
            isLoading={results.isLoading}
            isError={results.isError}
            error={results.error}
            isEmpty={!results.isLoading && !results.isError && all.length === 0}
            emptyTitle="No sermons yet"
            emptyDescription={name ? `Nothing published under “${name}” yet.` : undefined}
            onRetry={() => results.refetch()}
            loadingLabel="Loading sermons"
          >
            <View style={styles.grid}>
              {sermons.map((sermon) => (
                <SermonCard
                  key={sermon.id}
                  sermon={sermon}
                  width={cardWidth}
                  showMeta={false}
                  onPress={() => router.push({ pathname: '/player/[id]', params: { id: sermon.id } })}
                />
              ))}
            </View>
          </QueryState>
        </View>
      </ScrollView>
    </View>
  );
}

const useStyles = createThemedStyles((colors) => ({
  screen: {
    flex: 1,
    backgroundColor: colors.surface.app,
  },
  scroll: {
    flex: 1,
  },
  content: {
    paddingBottom: spacing.xxl * 2,
  },
  hero: {
    overflow: 'hidden',
    paddingHorizontal: spacing.lg + 4,
    paddingBottom: spacing.xl,
    borderBottomLeftRadius: 32,
    borderBottomRightRadius: 32,
    backgroundColor: colors.iris.soft,
  },
  orbBig: {
    position: 'absolute',
    width: 180,
    height: 180,
    borderRadius: 90,
    right: -40,
    top: 30,
    opacity: 0.14,
    backgroundColor: colors.iris.fill,
  },
  orbSun: {
    position: 'absolute',
    width: 70,
    height: 70,
    borderRadius: 35,
    right: 50,
    top: 96,
    backgroundColor: colors.sunButton.bg,
  },
  heroText: {
    gap: spacing.sm,
    marginTop: spacing.xl,
    paddingRight: 90,
  },
  eyebrow: {
    color: colors.iris.ink,
    letterSpacing: 1.5,
  },
  title: {
    color: colors.text.primary,
  },
  count: {
    color: colors.iris.ink,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm + 2,
    marginTop: spacing.lg,
  },
  playAll: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    height: 44,
    paddingHorizontal: spacing.lg + 2,
    borderRadius: 22,
    backgroundColor: colors.primaryButton.bg,
  },
  sort: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    height: 44,
    paddingHorizontal: spacing.lg + 2,
    borderRadius: 22,
    backgroundColor: colors.surface.raised,
  },
  pressed: {
    opacity: 0.85,
  },
  body: {
    padding: GRID_PADDING,
    paddingTop: spacing.xl,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: GRID_GAP,
    rowGap: spacing.lg + 2,
  },
}));
