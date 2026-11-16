import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, useWindowDimensions, View } from 'react-native';
import { FlashList, type ListRenderItem } from '@shopify/flash-list';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText, CircleButton, PlatformIcon, QueryState } from '../../components';
import { SermonCard } from '../../components/sermon/SermonCard';
import { createThemedStyles, useTheme } from '../../theme/ThemeContext';
import { spacing } from '../../theme/spacing';
import { useSearchResultsInfinite } from '../../lib/query/hooks/useSearch';
import type { SermonListItem } from '../../lib/query/hooks/useSermons';
import { useFetchAllPages } from '../../lib/hooks/useFetchAllPages';
import { usePullToRefresh } from '../../lib/hooks/usePullToRefresh';

const GRID_COLUMNS = 2;
const GRID_GAP = spacing.md;
const GRID_PADDING = spacing.lg + 4;
const ROW_GAP = spacing.lg + 2;

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
 * The grid is a two-column `FlashList` that pages through the whole topic 50 at a time
 * as you scroll (it used to stop at the first 20 while the header counted them all), so
 * long topics stay smooth: cards off screen are recycled rather than all kept mounted.
 * "Oldest" pages in the rest first, because `/search` only sorts newest first.
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
  const results = useSearchResultsInfinite({ category_id: id });
  const pullToRefresh = usePullToRefresh([results]);
  const { width: windowWidth } = useWindowDimensions();
  const cardWidth = (windowWidth - GRID_PADDING * 2 - GRID_GAP * (GRID_COLUMNS - 1)) / GRID_COLUMNS;
  const [oldestFirst, setOldestFirst] = useState(false);
  useFetchAllPages(results, oldestFirst);
  const all = results.data?.pages.flatMap((page) => page.results) ?? [];
  // Oldest first needs every page before it can reverse; until then the footer spins.
  const sermons = oldestFirst ? (results.hasNextPage ? [] : [...all].reverse()) : all;
  const total = results.data?.pages[0]?.total ?? all.length;
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = results;

  const renderItem: ListRenderItem<SermonListItem> = useCallback(
    ({ item, index }) => (
      // FlashList gives each column half the width; pin the card to the outer edge of its
      // half so the two cards sit GRID_PADDING from the screen edges and GRID_GAP apart.
      <View style={[styles.cell, index % GRID_COLUMNS === 0 ? styles.cellStart : styles.cellEnd]}>
        <SermonCard
          sermon={item}
          width={cardWidth}
          showMeta={false}
          onPress={() => router.push({ pathname: '/player/[id]', params: { id: item.id } })}
        />
      </View>
    ),
    [styles, cardWidth, router],
  );

  const header = (
    <>
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

      <View style={styles.bodyTop} />
    </>
  );

  return (
    <View style={styles.screen}>
      <FlashList
        data={sermons}
        renderItem={renderItem}
        keyExtractor={(item) => item.id}
        numColumns={GRID_COLUMNS}
        // Card art is 16:9 plus a one-line title block and the row gap.
        estimatedItemSize={Math.round((cardWidth * 9) / 16) + 52 + ROW_GAP}
        ListHeaderComponent={header}
        ListEmptyComponent={
          <View style={styles.state}>
            <QueryState
              isLoading={results.isLoading || (oldestFirst && all.length > 0)}
              isError={results.isError}
              error={results.error}
              isEmpty={!results.isLoading && !results.isError && all.length === 0}
              emptyTitle="No sermons yet"
              emptyDescription={name ? `Nothing published under “${name}” yet.` : undefined}
              onRetry={() => results.refetch()}
              loadingLabel="Loading sermons"
            >
              {null}
            </QueryState>
          </View>
        }
        ListFooterComponent={
          isFetchingNextPage && sermons.length > 0 ? (
            <ActivityIndicator style={styles.footerSpinner} color={colors.accent.gold} accessibilityLabel="Loading more sermons" />
          ) : null
        }
        onEndReached={() => {
          if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
        }}
        onEndReachedThreshold={0.6}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl {...pullToRefresh} />}
      />
    </View>
  );
}

const useStyles = createThemedStyles((colors) => ({
  screen: {
    flex: 1,
    backgroundColor: colors.surface.app,
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
  bodyTop: {
    height: spacing.xl,
  },
  state: {
    paddingHorizontal: GRID_PADDING,
  },
  cell: {
    paddingBottom: ROW_GAP,
  },
  cellStart: {
    paddingLeft: GRID_PADDING,
    alignItems: 'flex-start',
  },
  cellEnd: {
    paddingRight: GRID_PADDING,
    alignItems: 'flex-end',
  },
  footerSpinner: {
    paddingVertical: spacing.lg,
  },
}));
