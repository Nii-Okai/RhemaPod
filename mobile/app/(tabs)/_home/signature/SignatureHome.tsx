import React from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import type { UseQueryResult } from '@tanstack/react-query';
import { AppText, Avatar, StaggerItem } from '../../../../components';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { createThemedStyles, useTheme } from '../../../../theme/ThemeContext';
import { spacing } from '../../../../theme/spacing';
import { userMessageFor } from '../../../../lib/api/errors';
import { useHeroSermons } from '../../../../lib/query/hooks/useHeroSermons';
import { useContinueWatching } from '../../../../lib/query/hooks/useContinueWatching';
import { useNewReleases } from '../../../../lib/query/hooks/useNewReleases';
import { useNotificationsBadge } from '../../../../lib/query/hooks/useNotificationsBadge';
import { useProphetsCatalog } from '../../../../lib/query/hooks/useProphetsCatalog';
import { useRecommended } from '../../../../lib/query/hooks/useRecommended';
import { usePullToRefresh } from '../../../../lib/hooks/usePullToRefresh';
import { useTrending } from '../../../../lib/query/hooks/useTrending';
import { useSeriesList } from '../../../../lib/query/hooks/useSeries';
import { useUpcomingSermon } from '../../../../lib/query/hooks/useUpcomingSermon';
import { pathnameFor, routeByKey } from '../../../../components/navigation/routes';
import { SectionError } from '../../../../components/SectionError';
import { ShelfSkeleton } from '../../../../components/ShelfSkeleton';
import { HeroCarousel } from '../HeroCarousel';
import { HeroSkeleton } from '../HeroSkeleton';
import { HomeTopBar } from '../HomeTopBar';
import { CountdownCard } from './CountdownCard';
import { SignatureHeroCard } from './SignatureHeroCard';
import { SeriesSpotlightCard } from './SeriesSpotlightCard';
import { SeriesWalkCard } from './SeriesWalkCard';
import { VerseCard } from './VerseCard';
import {
  CatalogCard,
  PickCard,
  PosterCard,
  ReleaseCard,
  ResumeCard,
  SeriesTile,
  TrendingCard,
} from './shelfCards';
import { useSeriesWalk } from './useSeriesWalk';
import { leaf } from './leaf';
import { radius } from '../../../../theme/radius';

/** The Series grid: one row of two (Nii's call, 2026-10-21); "See all" opens the full list. */
const SERIES_COLUMNS = 2;
const SERIES_GRID_MAX = 2;

function chunk<T>(items: T[], size: number): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += size) rows.push(items.slice(i, i + size));
  return rows;
}

/** Fading gold hairline that runs from a shelf title toward the screen edge. */
function TitleRule() {
  const { colors } = useTheme();
  const styles = useStyles();
  return (
    <View style={styles.rule} pointerEvents="none">
      <Svg width="100%" height="100%" preserveAspectRatio="none">
        <Defs>
          <LinearGradient id="shelfRule" x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor={colors.accent.goldLine} stopOpacity={1} />
            <Stop offset="1" stopColor={colors.accent.goldLine} stopOpacity={0} />
          </LinearGradient>
        </Defs>
        <Rect width="100%" height="100%" fill="url(#shelfRule)" />
      </Svg>
    </View>
  );
}

/**
 * Shelf header (Nii's approved mockup, 2026-11-06): a gold leaf marker, the title one step
 * up the display scale, a fading gold rule and, where there is one, a "See all" pill — so
 * the headers hold their own against the artwork, especially in dark mode.
 */
function SectionTitle({
  children,
  onSeeAll,
  seeAllLabel,
}: {
  children: React.ReactNode;
  onSeeAll?: () => void;
  seeAllLabel?: string;
}) {
  const styles = useStyles();
  return (
    <View style={styles.titleRow}>
      <View style={styles.titleMark} />
      <AppText variant="display.shelf" accessibilityRole="header" style={styles.titleText}>
        {children}
      </AppText>
      <TitleRule />
      {onSeeAll ? (
        <Pressable
          onPress={onSeeAll}
          accessibilityRole="button"
          accessibilityLabel={seeAllLabel}
          hitSlop={spacing.md}
          style={styles.seeAll}
        >
          <AppText variant="ui.label" tone="gold">
            See all ›
          </AppText>
        </Pressable>
      ) : null}
    </View>
  );
}

/**
 * One horizontal shelf with the classic Home's loading / error / empty contract: a
 * skeleton while loading, an inline retry on error, and nothing at all when the endpoint
 * returns no items.
 */
function Shelf<T extends { id: string }>({
  title,
  query,
  renderItem,
}: {
  title: string;
  query: UseQueryResult<T[]>;
  renderItem: (item: T, index: number) => React.ReactNode;
}) {
  const styles = useStyles();
  const items = query.data ?? [];
  if (!query.isLoading && !query.isError && items.length === 0) return null;
  return (
    <View style={styles.section}>
      <View style={styles.gutter}>
        <SectionTitle>{title}</SectionTitle>
      </View>
      {query.isLoading ? (
        <View style={styles.gutter}>
          <ShelfSkeleton loadingLabel={`Loading ${title.toLowerCase()}`} />
        </View>
      ) : query.isError ? (
        <View style={styles.gutter}>
          <SectionError message={userMessageFor(query.error)} onRetry={() => query.refetch()} />
        </View>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
          {items.map((item, index) => (
            <StaggerItem key={item.id} index={index}>
              {renderItem(item, index)}
            </StaggerItem>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

/**
 * Home, Signature redesign (Nii's approved mockup "RhemaPod — Signature", 2026-10-21),
 * behind `SIGNATURE_HOME_ENABLED`. Same data and destinations as the classic Home, plus
 * the countdown to the next scheduled message (`GET /catalog/sermons/upcoming`):
 *
 *  verse of the day → "New this week" hero → pick up where you left off → new releases →
 *  next message countdown (only while one is scheduled) → Prophet's Pick → Series ("your
 *  walk" — or, with none yet, a spotlight on one series — above a two-column grid of the
 *  other series) → Prophet's Catalog → recommended for you → trending.
 *
 * The top bar sits above the scroll in normal flow (not over the art, as on the classic
 * Home) because the verse, not the hero, now opens the page.
 */
export function SignatureHomeScreen() {
  const styles = useStyles();
  const router = useRouter();
  const hero = useHeroSermons();
  const continueWatching = useContinueWatching();
  const newReleases = useNewReleases();
  const prophetsCatalog = useProphetsCatalog();
  const recommended = useRecommended();
  const trending = useTrending();
  const series = useSeriesList();
  const upcoming = useUpcomingSermon();
  const notificationsBadge = useNotificationsBadge();
  const seriesWalk = useSeriesWalk(continueWatching.data ?? []);

  const heroItems = hero.data ?? [];
  const catalogItems = prophetsCatalog.data ?? [];
  const pick = catalogItems[0];
  const walk = seriesWalk.walk;
  const seriesItems = series.data ?? [];
  // No walk yet (every brand-new account has none) — feature the first series instead of
  // leaving the section's top empty; `otherSeries` excludes whichever of the two is up top.
  const spotlightSeries = walk ? null : seriesItems[0] ?? null;
  const featuredSeriesId = walk?.seriesId ?? spotlightSeries?.id;
  const otherSeries = seriesItems.filter((item) => item.id !== featuredSeriesId).slice(0, SERIES_GRID_MAX);
  const walkThumbnail =
    seriesItems.find((item) => item.id === walk?.seriesId)?.thumbnail_url ?? walk?.current.thumbnail_url;
  // The catalogue is one speaker's; the header shows their avatar.
  const catalogSpeaker = catalogItems.find((item) => item.speaker_id && item.speaker_name) ?? null;

  const goToSermon = (id: string) => router.push({ pathname: '/player/[id]', params: { id } });
  const goToSeries = (id: string) => router.push({ pathname: '/series/[id]', params: { id } });
  const goToSeriesList = () => router.push(pathnameFor(routeByKey('series')));

  const pullToRefresh = usePullToRefresh([
    hero,
    continueWatching,
    newReleases,
    prophetsCatalog,
    recommended,
    trending,
    series,
    upcoming,
    seriesWalk,
  ]);

  return (
    <View style={styles.screen}>
      <HomeTopBar
        onSearchPress={() => router.push('/search')}
        onNotificationsPress={() => router.push('/notifications')}
        unseenNotificationsCount={notificationsBadge.unseenCount}
      />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl {...pullToRefresh} />
        }
      >
        <View style={styles.gutter}>
          <VerseCard />
        </View>

        <View style={styles.gutter}>
          {hero.isLoading ? (
            <HeroSkeleton />
          ) : hero.isError ? (
            <SectionError message={userMessageFor(hero.error)} onRetry={() => hero.refetch()} />
          ) : heroItems.length > 0 ? (
            <HeroCarousel
              sermons={heroItems}
              onPress={goToSermon}
              renderCard={(sermon, onPress) => <SignatureHeroCard sermon={sermon} onPress={onPress} />}
            />
          ) : (
            <View style={styles.centered}>
              <AppText variant="ui.bodyLarge" style={styles.centeredText}>
                No sermons yet
              </AppText>
              <AppText variant="ui.body" tone="secondary" style={styles.centeredText}>
                Check back once the catalogue has published sermons.
              </AppText>
            </View>
          )}
        </View>

        <Shelf
          title="Pick up where you left off"
          query={continueWatching}
          renderItem={(item) => <ResumeCard item={item} onPress={() => goToSermon(item.id)} />}
        />

        <Shelf
          title="New releases"
          query={newReleases}
          renderItem={(item) => <ReleaseCard sermon={item} onPress={() => goToSermon(item.id)} />}
        />

        {upcoming.data ? (
          <View style={styles.gutter}>
            <CountdownCard
              key={upcoming.data.id}
              sermon={upcoming.data}
              onReleased={() => {
                void upcoming.refetch();
                void newReleases.refetch();
                void hero.refetch();
              }}
            />
          </View>
        ) : null}

        {prophetsCatalog.isLoading || prophetsCatalog.isError || pick ? (
          <View style={[styles.section, styles.gutter]}>
            <SectionTitle>
              Prophet&rsquo;s{' '}
              <AppText variant="display.shelf" tone="gold">
                Pick
              </AppText>
            </SectionTitle>
            {prophetsCatalog.isLoading ? (
              <ShelfSkeleton loadingLabel="Loading Prophet's Pick" />
            ) : prophetsCatalog.isError ? (
              <SectionError
                message={userMessageFor(prophetsCatalog.error)}
                onRetry={() => prophetsCatalog.refetch()}
              />
            ) : pick ? (
              <PickCard sermon={pick} onPress={() => goToSermon(pick.id)} />
            ) : null}
          </View>
        ) : null}

        <View style={[styles.section, styles.gutter]}>
          <SectionTitle onSeeAll={goToSeriesList} seeAllLabel="See all series">
            Series
          </SectionTitle>
          {walk ? (
            <SeriesWalkCard
              walk={walk}
              thumbnailUrl={walkThumbnail}
              onOpenSeries={() => goToSeries(walk.seriesId)}
              onResume={() => goToSermon(walk.current.id)}
            />
          ) : spotlightSeries ? (
            <SeriesSpotlightCard series={spotlightSeries} onPress={() => goToSeries(spotlightSeries.id)} />
          ) : null}
          {series.isLoading ? (
            <ShelfSkeleton loadingLabel="Loading series" />
          ) : series.isError ? (
            <SectionError message={userMessageFor(series.error)} onRetry={() => series.refetch()} />
          ) : seriesItems.length === 0 ? (
            <AppText variant="ui.body" tone="secondary">
              No series yet — check back once the catalogue has one.
            </AppText>
          ) : (
            <View style={styles.grid}>
              {chunk(otherSeries, SERIES_COLUMNS).map((row) => (
                <View key={row[0].id} style={styles.gridRow}>
                  {Array.from({ length: SERIES_COLUMNS }, (_, i) => row[i]).map((item, i) => (
                    <View key={item?.id ?? `empty-${i}`} style={styles.gridCell}>
                      {item ? <SeriesTile series={item} onPress={() => goToSeries(item.id)} /> : null}
                    </View>
                  ))}
                </View>
              ))}
            </View>
          )}
        </View>

        {catalogItems.length > 0 ? (
          <View style={styles.section}>
            <View style={[styles.gutter, styles.catalogHeader]}>
              {catalogSpeaker?.speaker_name ? (
                <View style={styles.avatarRing}>
                  <Avatar
                    name={catalogSpeaker.speaker_name}
                    seed={catalogSpeaker.speaker_id ?? catalogSpeaker.speaker_name}
                    size={48}
                  />
                </View>
              ) : null}
              <AppText variant="display.shelf" accessibilityRole="header" style={styles.catalogTitle}>
                Prophet&rsquo;s Catalog
              </AppText>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
              {catalogItems.map((item, index) => (
                <StaggerItem key={item.id} index={index}>
                  <CatalogCard sermon={item} onPress={() => goToSermon(item.id)} />
                </StaggerItem>
              ))}
            </ScrollView>
          </View>
        ) : null}

        <Shelf
          title="Recommended for you"
          query={recommended}
          renderItem={(item) => <PosterCard sermon={item} onPress={() => goToSermon(item.id)} />}
        />

        <Shelf
          title="Trending"
          query={trending}
          renderItem={(item, index) => (
            <TrendingCard rank={index + 1} sermon={item} onPress={() => goToSermon(item.id)} />
          )}
        />
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
    paddingTop: spacing.lg,
    paddingBottom: spacing.xxl * 2,
    gap: spacing.xxl + spacing.lg,
  },
  gutter: {
    paddingHorizontal: spacing.lg,
  },
  section: {
    gap: spacing.md,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  titleMark: {
    width: 6,
    height: 28,
    backgroundColor: colors.accent.gold,
    ...leaf(4, 1),
  },
  titleText: {
    flexShrink: 1,
  },
  rule: {
    flex: 1,
    minWidth: spacing.md,
    height: 1,
  },
  seeAll: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.accent.goldLine,
    backgroundColor: colors.accent.goldWash,
  },
  row: {
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  centered: {
    paddingVertical: spacing.xxl,
    alignItems: 'center',
    gap: spacing.xs,
  },
  centeredText: {
    textAlign: 'center',
  },
  grid: {
    gap: spacing.md,
    paddingTop: spacing.xs,
  },
  gridRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  gridCell: {
    flex: 1,
  },
  catalogHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  avatarRing: {
    padding: 2,
    borderRadius: 28,
    borderWidth: 2,
    borderColor: colors.accent.gold,
  },
  catalogTitle: {
    flex: 1,
  },
}));
