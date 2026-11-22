import React, { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import type { UseQueryResult } from '@tanstack/react-query';
import { AppText, Avatar, FrostedHeader, StaggerItem, useFrostedScroll } from '../../../../components';
import { createThemedStyles } from '../../../../theme/ThemeContext';
import { spacing } from '../../../../theme/spacing';
import { isOfflineError, userMessageFor } from '../../../../lib/api/errors';
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
import { useTabContentWidth, useTabGridColumns } from '../../../../components/navigation/responsive';
import { SectionError } from '../../../../components/SectionError';
import { ShelfSkeleton } from '../../../../components/ShelfSkeleton';
import { OfflineBanner, OfflineCard, OfflineShelf } from '../../../../components/offline';
import { HeroCarousel } from '../HeroCarousel';
import { HeroSkeleton } from '../HeroSkeleton';
import { HomeHeader } from '../HomeHeader';
import { CountdownCard } from './CountdownCard';
import { SignatureHeroCard } from './SignatureHeroCard';
import { SeriesSpotlightCard } from './SeriesSpotlightCard';
import { SeriesWalkCard } from './SeriesWalkCard';
import { VerseCard } from './VerseCard';
import { DailyRhemaCard } from './DailyRhemaCard';
import { ChurchWeekSection } from './ChurchWeekSection';
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

/** The Series grid: one row of two (Nii's call, 2026-10-21); "See all" opens the full list. */
// Content this wide (tablet landscape) puts the hero and Daily Rhema side by side.
const WIDE_HOME_MIN_WIDTH = 900;
// The "New this week" hero card's art shape (`SignatureHeroCard`), for its offline stand-in.
const HERO_ASPECT_RATIO = 16 / 10;

function chunk<T>(items: T[], size: number): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += size) rows.push(items.slice(i, i + size));
  return rows;
}

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
      <AppText variant="display.section" accessibilityRole="header">
        {children}
      </AppText>
      {onSeeAll ? (
        <Pressable
          onPress={onSeeAll}
          accessibilityRole="button"
          accessibilityLabel={seeAllLabel}
          hitSlop={spacing.md}
        >
          <AppText variant="ui.label" tone="gold">
            See all
          </AppText>
        </Pressable>
      ) : null}
    </View>
  );
}

/** A shelf card's width and art shape, so its offline ghosts sit where the cards will. */
interface GhostShape {
  width: number;
  aspectRatio: number;
}

/**
 * One horizontal shelf with the classic Home's loading / error / empty contract: a
 * skeleton while loading, an inline retry on error, and nothing at all when the endpoint
 * returns no items. Offline (offline mockups, Nii 2026-11-22) it keeps any cards it already
 * has, and otherwise shows ghost cards in its own shape that open the offline page.
 */
function Shelf<T extends { id: string }>({
  title,
  query,
  renderItem,
  ghost,
}: {
  title: string;
  query: UseQueryResult<T[]>;
  renderItem: (item: T, index: number) => React.ReactNode;
  ghost: GhostShape;
}) {
  const styles = useStyles();
  const items = query.data ?? [];
  const offline = query.isError && isOfflineError(query.error);
  if (!query.isLoading && !query.isError && items.length === 0) return null;
  // Cards it already has stay up through a failed refresh.
  const showItems = items.length > 0;
  return (
    <View style={styles.section}>
      <View style={styles.gutter}>
        <SectionTitle>{title}</SectionTitle>
      </View>
      {query.isLoading ? (
        <View style={styles.gutter}>
          <ShelfSkeleton loadingLabel={`Loading ${title.toLowerCase()}`} />
        </View>
      ) : offline && !showItems ? (
        <OfflineShelf title={title} cardWidth={ghost.width} aspectRatio={ghost.aspectRatio} />
      ) : query.isError && !showItems ? (
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
 * reworked for the Daybreak redesign (2026-11, canvas B1/B2): a greeting header, then
 *
 *  verse of the day → Daily Rhema → keep listening → "New this week" hero → new releases →
 *  this week at church → next message countdown (only while one is scheduled) →
 *  Prophet's Pick → Series ("your
 *  walk" — or, with none yet, a spotlight on one series — above a two-column grid of the
 *  other series) → Prophet's Catalog → recommended for you → trending.
 *
 * On a tablet in landscape (mockups, Nii 2026-11-21) the hero moves up beside Daily Rhema,
 * and the series grid shows a row of 3–4 instead of 2.
 *
 * The header is frosted and laid over the top of the scroll (`FrostedHeader`): the page
 * starts below it and blurs up under it as it scrolls.
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
  const [headerHeight, setHeaderHeight] = useState(0);
  const frosted = useFrostedScroll(headerHeight);
  const contentWidth = useTabContentWidth();
  const wide = contentWidth >= WIDE_HOME_MIN_WIDTH;
  // One row of other series under the walk/spotlight: 2 on a phone, 3–4 on a tablet.
  const seriesColumns = useTabGridColumns();

  const heroItems = hero.data ?? [];
  const catalogItems = prophetsCatalog.data ?? [];
  const pick = catalogItems[0];
  const walk = seriesWalk.walk;
  const seriesItems = series.data ?? [];
  // No walk yet (every brand-new account has none) — feature the first series instead of
  // leaving the section's top empty; `otherSeries` excludes whichever of the two is up top.
  const spotlightSeries = walk ? null : seriesItems[0] ?? null;
  const featuredSeriesId = walk?.seriesId ?? spotlightSeries?.id;
  const otherSeries = seriesItems.filter((item) => item.id !== featuredSeriesId).slice(0, seriesColumns);
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

  const heroContent = (
    <>
      {hero.isLoading ? (
        <HeroSkeleton />
      ) : hero.isError && isOfflineError(hero.error) && heroItems.length === 0 ? (
        <OfflineCard
          aspectRatio={HERO_ASPECT_RATIO}
          title="This week’s message is waiting"
          message="It will appear when you’re back online"
        />
      ) : hero.isError && heroItems.length === 0 ? (
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
    </>
  );

  return (
    <View style={styles.screen}>
      <FrostedHeader scrolled={frosted.scrolled} onHeight={setHeaderHeight}>
        <HomeHeader
          onSearchPress={() => router.push('/search')}
          onNotificationsPress={() => router.push('/notifications')}
          unseenNotificationsCount={notificationsBadge.unseenCount}
          style={styles.headerClear}
        />
      </FrostedHeader>
      <ScrollView
        ref={frosted.ref}
        {...frosted.scrollProps}
        style={styles.scroll}
        contentContainerStyle={[styles.content, frosted.contentPadding(spacing.md, spacing.xxl)]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl {...pullToRefresh} progressViewOffset={frosted.progressViewOffset} />
        }
      >
        <OfflineBanner style={styles.banner} />
        <View style={styles.gutter}>
          <VerseCard />
        </View>
        {wide ? (
          <View style={[styles.gutter, styles.heroRow]}>
            <View style={styles.heroPane}>{heroContent}</View>
            <View style={styles.rhemaPane}>
              <DailyRhemaCard />
            </View>
          </View>
        ) : (
          <View style={styles.gutter}>
            <DailyRhemaCard />
          </View>
        )}

        <Shelf
          title="Keep listening"
          query={continueWatching}
          renderItem={(item) => <ResumeCard item={item} onPress={() => goToSermon(item.id)} />}
          ghost={{ width: 220, aspectRatio: 16 / 9 }}
        />

        {wide ? null : <View style={styles.gutter}>{heroContent}</View>}

        <Shelf
          title="New releases"
          query={newReleases}
          renderItem={(item) => <ReleaseCard sermon={item} onPress={() => goToSermon(item.id)} />}
          ghost={{ width: 240, aspectRatio: 16 / 9 }}
        />

        <View style={styles.gutter}>
          <ChurchWeekSection onOpenAll={() => router.push(pathnameFor(routeByKey('announcements')))} />
        </View>

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
              <AppText variant="display.section" tone="gold">
                Pick
              </AppText>
            </SectionTitle>
            {prophetsCatalog.isLoading ? (
              <ShelfSkeleton loadingLabel="Loading Prophet's Pick" />
            ) : prophetsCatalog.isError && isOfflineError(prophetsCatalog.error) && !pick ? (
              <OfflineCard
                aspectRatio={16 / 9}
                title="This week’s pick is waiting"
                message="Connect to listen"
              />
            ) : prophetsCatalog.isError && !pick ? (
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
            <SectionError
              message={userMessageFor(series.error)}
              onRetry={() => series.refetch()}
              error={series.error}
            />
          ) : seriesItems.length === 0 ? (
            <AppText variant="ui.body" tone="secondary">
              No series yet — check back once the catalogue has one.
            </AppText>
          ) : (
            <View style={styles.grid}>
              {chunk(otherSeries, seriesColumns).map((row) => (
                <View key={row[0].id} style={styles.gridRow}>
                  {Array.from({ length: seriesColumns }, (_, i) => row[i]).map((item, i) => (
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
              <AppText variant="display.section" accessibilityRole="header" style={styles.catalogTitle}>
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
          ghost={{ width: 130, aspectRatio: 130 / 190 }}
        />

        <Shelf
          title="Trending"
          query={trending}
          renderItem={(item, index) => (
            <TrendingCard rank={index + 1} sermon={item} onPress={() => goToSermon(item.id)} />
          )}
          ghost={{ width: 120, aspectRatio: 120 / 176 }}
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
  headerClear: {
    backgroundColor: 'transparent',
  },
  content: {
    paddingTop: spacing.md,
    paddingBottom: spacing.xxl,
    gap: spacing.xxl + spacing.xs,
  },
  gutter: {
    paddingHorizontal: spacing.lg,
  },
  banner: {
    marginHorizontal: spacing.lg,
  },
  section: {
    gap: spacing.md,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: spacing.md,
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
  heroRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.lg,
  },
  heroPane: {
    flex: 1.65,
    minWidth: 0,
  },
  rhemaPane: {
    flex: 1,
    minWidth: 0,
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
