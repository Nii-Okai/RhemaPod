import React, { useRef, useState } from 'react';
import { Animated, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText, PlatformIcon, StaggerItem } from '../../components';
import { colors } from '../../theme/colors';
import { spacing } from '../../theme/spacing';
import { userMessageFor } from '../../lib/api/errors';
import { useHeroSermons } from '../../lib/query/hooks/useHeroSermons';
import { useContinueWatching } from '../../lib/query/hooks/useContinueWatching';
import { useNewReleases } from '../../lib/query/hooks/useNewReleases';
import { useNotificationsBadge } from '../../lib/query/hooks/useNotificationsBadge';
import { useProphetsCatalog } from '../../lib/query/hooks/useProphetsCatalog';
import { useRecommended } from '../../lib/query/hooks/useRecommended';
import { useTrending } from '../../lib/query/hooks/useTrending';
import { useSeriesList } from '../../lib/query/hooks/useSeries';
import { pathnameFor, routeByKey } from '../../components/navigation/routes';
import { ContinueWatchingCard } from '../../components/sermon/ContinueWatchingCard';
import { HeroCarousel } from './_home/HeroCarousel';
import { HeroSkeleton } from './_home/HeroSkeleton';
import { HomeTopBar } from './_home/HomeTopBar';
import { ImageOnlyCard } from '../../components/sermon/ImageOnlyCard';
import { SectionError } from '../../components/SectionError';
import { SeriesCard } from '../../components/series/SeriesCard';
import { SermonCard } from '../../components/sermon/SermonCard';
import { ShelfSkeleton } from '../../components/ShelfSkeleton';
import { SpotlightCard } from './_home/SpotlightCard';
import { VerseStrip } from './_home/VerseStrip';

// Shared sizing for both image-only discovery shelves (Isaac's ask: "a little
// slimmer but taller" than `ImageOnlyCard`'s own 160×16:9 default, applied to
// Trending first then to Recommended for consistency) — narrower width, portrait
// 3:4 box. `ImageOnlyCard` itself renders with `resizeMode="contain"`, so nothing
// is cropped to fit this box; no extra logic needed here beyond the dimensions.
const DISCOVERY_CARD_WIDTH = 120;
const DISCOVERY_CARD_ASPECT_RATIO = 3 / 4;

// New Releases gets its own, wider card (Isaac's ask: give the shelf visual variance
// rather than sharing Series/Prophet's Catalog's 200px width) and drops the meta line
// (speaker/duration) entirely for a leaner, art-forward card — between this and the
// two sizes above, no two adjacent shelves on Home share a card footprint.
const NEW_RELEASE_CARD_WIDTH = 240;

/** Groups a flat list into row-pairs for Series' 2-row grid shelf (Isaac's ask: break
    the "every shelf is a single horizontal row" rhythm for at least one shelf, Apple
    TV+'s mixed-layout pattern). A trailing odd item gets its own single-item column
    rather than a phantom empty slot. */
function chunkPairs<T>(items: T[]): T[][] {
  const pairs: T[][] = [];
  for (let i = 0; i < items.length; i += 2) {
    pairs.push(items.slice(i, i + 2));
  }
  return pairs;
}

/**
 * Home (design spec §3 Home / 1b iOS / 2a Android): hero (P5 — first item of
 * `GET /catalog/sermons`, server-ordered newest-published-first, no client pin) +
 * "Continue watching" / "Series" / "Recommended for you" / "Trending" shelves, each
 * omitted entirely when empty (matches "Continue watching"'s own pre-existing
 * convention — the spec shows no empty-state card for a shelf like this, and a
 * discovery shelf with nothing to show is exactly that: nothing to show, not an error).
 * No platform-chrome fork lives in this screen's own content — the base spec describes
 * Home's iOS/Android variants as the same content model, chrome-only differences that
 * `NavShell` (W3.4) already owns; §8.5's top-app-bar swap is specific to the detail
 * screen, not this one.
 *
 * "Recommended for you"/"Trending" (Isaac's ask, session 2026-09-29) are image-only
 * cards (`ImageOnlyCard`, no title/meta text under the art) backed by two endpoints — see
 * `content_service.list_recommended_sermons`/`list_trending_sermons` for the actual
 * selection logic (category/speaker affinity from watch history, falling back to a 30-day
 * play-count ranking).
 *
 * "New Releases"/"Prophet's Catalog" (Isaac's ask, session 2026-09-30) use the titled
 * `SermonCard` instead — both are editorial/curated shelves (newest-published; manually
 * flagged via the admin editor's switch), not algorithmic discovery, so the title carries
 * real information the way Series' cards do. Placed with the other editorial shelves
 * (Continue Watching → New Releases → Series → Prophet's Catalog), ahead of the two
 * algorithmic ones at the bottom. New Releases uses its own wider, meta-less sizing
 * (`NEW_RELEASE_CARD_WIDTH`) — Isaac's ask for visual variance between shelves, session
 * 2026-09-30 — so Home doesn't read as five identical rows of the same card shape.
 * Prophet's Catalog's and Recommended's item ORDER is also deliberately randomized
 * server-side (`content_service._daily_shuffle`) for the same reason: those two had no
 * real ordering signal of their own and were defaulting to the same `published_at desc`
 * tiebreak New Releases uses for real, so an overlapping candidate pool could render as a
 * literal duplicate shelf. New Releases and Trending keep their own strict, meaningful
 * order (recency; play count) — only the two signal-less shelves are shuffled.
 *
 * The P2 Announcements entry point isn't a section here anymore, and `HomeTopBar`'s bell
 * icon no longer opens it either (Isaac's ask, session 2026-10-11 — the bell now opens
 * `/notifications`, a new-releases list, instead); the You tab's own Announcements row
 * is the surviving entry point into `/announcements`. The top bar also lost its Library
 * icon entirely (same session) — Library is already the phone tab bar's own destination,
 * one tap away regardless of which screen you're on, so a second, Home-specific shortcut
 * to it was redundant.
 *
 * "Make it more alive" pass (Isaac's ask, session 2026-09-30), everything except
 * per-item color theming (flagged as needing a new dependency, deferred):
 *  - Every shelf card uses `PressableScale` (spring scale-down on press) instead of a
 *    flat opacity change — `HeroCard`'s own full-bleed "tap anywhere" layer keeps its
 *    original opacity feedback; scaling the whole hero down on a background tap reads
 *    as the page flexing, not a button responding.
 *  - Cards fade/rise in via `StaggerItem` on first mount, staggered by position.
 *  - `VerseStrip` — one verse of the day, this app's own signature rather than
 *    anything borrowed from an entertainment app.
 *  - `SpotlightCard` — a full-bleed feature of Prophet's Catalog's current top pick
 *    (same daily shuffle that shelf already uses), between Series and the regular
 *    Prophet's Catalog row — double-featuring the same item is the established
 *    pattern (Apple TV+, Netflix), not a bug.
 *  - Series renders as a 2-row grid (`chunkPairs`) instead of a single row, for rhythm.
 *  - Pull-to-refresh, gold-tinted, refetches every shelf.
 *  - Prophet's Catalog's `SermonCard`s render `highlighted` — a thin gold ring, so the
 *    shelf's name means something visually too.
 *
 * Hero carousel (Isaac's ask, session 2026-09-30, overriding the plan's original P5
 * single-item hero): up to 3 items (`useHeroSermons`, capped to one per series
 * server-side — see `content_service.list_hero_sermons`), auto-advancing, via
 * `HeroCarousel`.
 *
 * Top bar scroll-fade (Isaac's ask, session 2026-09-30 — Prime Video/Netflix's pattern):
 * `HomeTopBar` renders in `topBarOverlay`, absolutely positioned over the scroll content
 * rather than pushing it down, so the hero's art extends up underneath it. `scrollY`
 * (an `Animated.Value` fed by the main `Animated.ScrollView`'s `onScroll`) drives the
 * bar from transparent at rest to solid `colors.surface.app` by ~180px of scroll — see
 * `HomeTopBar`'s own doc comment for why it *also* always carries a constant low-opacity
 * scrim underneath that fade (legibility over the hero art at rest, before any
 * scrolling).
 *
 * The content area itself starts at `insets.top`, not 0 (a fix, session 2026-09-30: the
 * hero's art was extending all the way to the physical notch/Dynamic Island, which
 * looked broken — only a flat-colored backdrop, never photographic art, belongs behind
 * that hardware cutout). `topBarHeight` (measured via `HomeTopBar`'s `onHeight`) already
 * includes that same `insets.top`, so `barRowHeight` — the remainder, i.e. just the
 * bar's icon row — is what actually gets threaded down into `HeroCarousel` → `HeroCard`
 * as `topInset` (keeping the hero's "New this week" chip clear of the bar's
 * wordmark/icons) and into the three non-hero branches (`HeroSkeleton`, `SectionError`,
 * the empty state) as plain `paddingTop`.
 */
export default function HomeScreen() {
  const router = useRouter();
  const hero = useHeroSermons();
  const continueWatching = useContinueWatching();
  const newReleases = useNewReleases();
  const prophetsCatalog = useProphetsCatalog();
  const recommended = useRecommended();
  const trending = useTrending();
  const series = useSeriesList();

  const heroItems = hero.data ?? [];
  const continueWatchingItems = continueWatching.data ?? [];
  const newReleaseItems = newReleases.data ?? [];
  const prophetsCatalogItems = prophetsCatalog.data ?? [];
  const recommendedItems = recommended.data ?? [];
  const trendingItems = trending.data ?? [];
  const seriesItems = series.data ?? [];

  const goToSermon = (id: string) => router.push({ pathname: '/sermon/[id]', params: { id } });
  // W4.4 owns `/series/[id]`'s screen — this is only the navigation call, per the
  // Conductor's decision not to create that route file here.
  const goToSeries = (id: string) => router.push({ pathname: '/series/[id]', params: { id } });
  const goToNotifications = () => router.push('/notifications');
  // `/search` is a top-level stack route (not a tab) since the Search tab was removed
  // (Isaac's ask, session 2026-10-02) — no `routeByKey` entry for it anymore.
  const goToSearch = () => router.push('/search');
  const goToSeriesList = () => router.push(pathnameFor(routeByKey('series')));
  const notificationsBadge = useNotificationsBadge();

  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([
      hero.refetch(),
      continueWatching.refetch(),
      newReleases.refetch(),
      prophetsCatalog.refetch(),
      recommended.refetch(),
      trending.refetch(),
      series.refetch(),
    ]);
    setRefreshing(false);
  };

  // Drives HomeTopBar's scroll-fade (Isaac's ask, session 2026-09-30: a Prime Video/
  // Netflix-style bar that's transparent over the hero and solidifies as you scroll past
  // it) — `useNativeDriver: false` because color/opacity-of-a-background interpolation
  // isn't native-driver-eligible; this is a top-bar tint, not a high-frequency animation,
  // so running it on the JS thread is an acceptable trade.
  const scrollY = useRef(new Animated.Value(0)).current;
  const [topBarHeight, setTopBarHeight] = useState(0);
  const insets = useSafeAreaInsets();
  // `topBarHeight` (HomeTopBar's own measured height) already includes its internal
  // `insets.top` padding — the notch/Dynamic Island strip itself. Content starts at
  // `insets.top` (below the notch), not 0, so only the bar's solid/scrim backdrop (a
  // flat color) ever paints behind the notch — never the hero's actual photographic
  // art (Isaac's report, session 2026-09-30: the hero was overlapping the notch/Dynamic
  // Island). What the hero still needs to clear is just the bar's icon *row*, i.e. the
  // remainder below the notch.
  const barRowHeight = Math.max(0, topBarHeight - insets.top);

  return (
    <View style={styles.screen}>
      <View style={styles.topBarOverlay}>
        <HomeTopBar
          onSearchPress={goToSearch}
          onNotificationsPress={goToNotifications}
          unseenNotificationsCount={notificationsBadge.unseenCount}
          scrollY={scrollY}
          onHeight={setTopBarHeight}
        />
      </View>
      <Animated.ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingTop: insets.top }]}
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], {
          useNativeDriver: false,
        })}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.accent.gold}
            colors={[colors.accent.gold]}
          />
        }
      >
      {hero.isLoading ? (
        <View style={{ paddingTop: barRowHeight }}>
          <HeroSkeleton />
        </View>
      ) : hero.isError ? (
        <View style={{ paddingTop: barRowHeight }}>
          <SectionError message={userMessageFor(hero.error)} onRetry={() => hero.refetch()} />
        </View>
      ) : heroItems.length > 0 ? (
        // No top padding here, unlike the other three branches — the hero art is meant
        // to extend up under the transparent top bar (`topBarOverlay`) as far as the
        // content area's own top edge (`insets.top`, below the notch); only its own
        // internal eyebrow chip needs pushed clear of the bar's icon row, via `topInset`.
        <HeroCarousel sermons={heroItems} onPress={goToSermon} topInset={barRowHeight} />
      ) : (
        <View style={[styles.centered, { paddingTop: barRowHeight }]}>
          <AppText variant="ui.bodyLarge" style={styles.centeredText}>
            No sermons yet
          </AppText>
          <AppText variant="ui.body" tone="secondary" style={styles.centeredText}>
            Check back once the catalogue has published sermons.
          </AppText>
        </View>
      )}

      <VerseStrip />

      {continueWatching.isLoading ? (
        <View style={styles.section}>
          <AppText variant="ui.label" tone="secondary" style={styles.sectionLabel}>
            continue watching
          </AppText>
          <ShelfSkeleton loadingLabel="Loading continue watching" />
        </View>
      ) : continueWatching.isError ? (
        <View style={styles.section}>
          <AppText variant="ui.label" tone="secondary" style={styles.sectionLabel}>
            continue watching
          </AppText>
          <SectionError message={userMessageFor(continueWatching.error)} onRetry={() => continueWatching.refetch()} />
        </View>
      ) : continueWatchingItems.length > 0 ? (
        <View style={styles.section}>
          <AppText variant="ui.label" tone="secondary" style={styles.sectionLabel}>
            continue watching
          </AppText>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.shelf}>
            {continueWatchingItems.map((item, index) => (
              <StaggerItem key={item.id} index={index}>
                <ContinueWatchingCard item={item} onPress={() => goToSermon(item.id)} />
              </StaggerItem>
            ))}
          </ScrollView>
        </View>
      ) : null}

      {newReleases.isLoading ? (
        <View style={styles.section}>
          <AppText variant="ui.label" tone="secondary" style={styles.sectionLabel}>
            new releases
          </AppText>
          <ShelfSkeleton loadingLabel="Loading new releases" />
        </View>
      ) : newReleases.isError ? (
        <View style={styles.section}>
          <AppText variant="ui.label" tone="secondary" style={styles.sectionLabel}>
            new releases
          </AppText>
          <SectionError message={userMessageFor(newReleases.error)} onRetry={() => newReleases.refetch()} />
        </View>
      ) : newReleaseItems.length > 0 ? (
        <View style={styles.section}>
          <AppText variant="ui.label" tone="secondary" style={styles.sectionLabel}>
            new releases
          </AppText>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.shelf}>
            {newReleaseItems.map((item, index) => (
              <StaggerItem key={item.id} index={index}>
                <SermonCard
                  sermon={item}
                  onPress={() => goToSermon(item.id)}
                  width={NEW_RELEASE_CARD_WIDTH}
                  showMeta={false}
                />
              </StaggerItem>
            ))}
          </ScrollView>
        </View>
      ) : null}

      <View style={styles.section}>
        <Pressable
          onPress={goToSeriesList}
          accessibilityRole="button"
          accessibilityLabel="See all series"
          style={({ pressed }) => [styles.sectionHeaderRow, pressed && styles.sectionHeaderRowPressed]}
        >
          <AppText variant="ui.label" tone="secondary" style={styles.sectionLabel}>
            series
          </AppText>
          <PlatformIcon name="chevron-forward" size={18} color={colors.text.secondary} />
        </Pressable>
        {series.isLoading ? (
          <ShelfSkeleton loadingLabel="Loading series" />
        ) : series.isError ? (
          <SectionError message={userMessageFor(series.error)} onRetry={() => series.refetch()} />
        ) : seriesItems.length === 0 ? (
          <AppText variant="ui.body" tone="secondary">
            No series yet — check back once the catalogue has one.
          </AppText>
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.shelf}>
            {chunkPairs(seriesItems).map((pair, columnIndex) => (
              <View key={pair[0].id} style={styles.seriesColumn}>
                {pair.map((item, rowIndex) => (
                  <StaggerItem key={item.id} index={columnIndex * 2 + rowIndex}>
                    <SeriesCard series={item} onPress={() => goToSeries(item.id)} />
                  </StaggerItem>
                ))}
              </View>
            ))}
          </ScrollView>
        )}
      </View>

      {prophetsCatalog.isLoading ? (
        <View style={styles.section}>
          <AppText variant="ui.label" tone="secondary" style={styles.sectionLabel}>
            prophet&rsquo;s catalog
          </AppText>
          <ShelfSkeleton loadingLabel="Loading Prophet's Catalog" />
        </View>
      ) : prophetsCatalog.isError ? (
        <View style={styles.section}>
          <AppText variant="ui.label" tone="secondary" style={styles.sectionLabel}>
            prophet&rsquo;s catalog
          </AppText>
          <SectionError message={userMessageFor(prophetsCatalog.error)} onRetry={() => prophetsCatalog.refetch()} />
        </View>
      ) : prophetsCatalogItems.length > 0 ? (
        <>
          <StaggerItem index={0}>
            <SpotlightCard sermon={prophetsCatalogItems[0]} onPress={() => goToSermon(prophetsCatalogItems[0].id)} />
          </StaggerItem>
          <View style={styles.section}>
            <AppText variant="ui.label" tone="secondary" style={styles.sectionLabel}>
              prophet&rsquo;s catalog
            </AppText>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.shelf}>
              {prophetsCatalogItems.map((item, index) => (
                <StaggerItem key={item.id} index={index}>
                  <SermonCard sermon={item} onPress={() => goToSermon(item.id)} highlighted showMeta={false} />
                </StaggerItem>
              ))}
            </ScrollView>
          </View>
        </>
      ) : null}

      {recommended.isLoading ? (
        <View style={styles.section}>
          <AppText variant="ui.label" tone="secondary" style={styles.sectionLabel}>
            recommended for you
          </AppText>
          <ShelfSkeleton loadingLabel="Loading recommended for you" />
        </View>
      ) : recommended.isError ? (
        <View style={styles.section}>
          <AppText variant="ui.label" tone="secondary" style={styles.sectionLabel}>
            recommended for you
          </AppText>
          <SectionError message={userMessageFor(recommended.error)} onRetry={() => recommended.refetch()} />
        </View>
      ) : recommendedItems.length > 0 ? (
        <View style={styles.section}>
          <AppText variant="ui.label" tone="secondary" style={styles.sectionLabel}>
            recommended for you
          </AppText>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.shelf}>
            {recommendedItems.map((item, index) => (
              <StaggerItem key={item.id} index={index}>
                <ImageOnlyCard
                  sermon={item}
                  onPress={() => goToSermon(item.id)}
                  width={DISCOVERY_CARD_WIDTH}
                  aspectRatio={DISCOVERY_CARD_ASPECT_RATIO}
                />
              </StaggerItem>
            ))}
          </ScrollView>
        </View>
      ) : null}

      {trending.isLoading ? (
        <View style={styles.section}>
          <AppText variant="ui.label" tone="secondary" style={styles.sectionLabel}>
            trending
          </AppText>
          <ShelfSkeleton loadingLabel="Loading trending" />
        </View>
      ) : trending.isError ? (
        <View style={styles.section}>
          <AppText variant="ui.label" tone="secondary" style={styles.sectionLabel}>
            trending
          </AppText>
          <SectionError message={userMessageFor(trending.error)} onRetry={() => trending.refetch()} />
        </View>
      ) : trendingItems.length > 0 ? (
        <View style={styles.section}>
          <AppText variant="ui.label" tone="secondary" style={styles.sectionLabel}>
            trending
          </AppText>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.shelf}>
            {trendingItems.map((item, index) => (
              <StaggerItem key={item.id} index={index}>
                <ImageOnlyCard
                  sermon={item}
                  onPress={() => goToSermon(item.id)}
                  width={DISCOVERY_CARD_WIDTH}
                  aspectRatio={DISCOVERY_CARD_ASPECT_RATIO}
                />
              </StaggerItem>
            ))}
          </ScrollView>
        </View>
      ) : null}
      </Animated.ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.surface.app,
  },
  topBarOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
  },
  scroll: {
    flex: 1,
  },
  content: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xxl * 2,
    gap: spacing.xxl,
  },
  centered: {
    paddingVertical: spacing.xxl,
    alignItems: 'center',
    gap: spacing.xs,
  },
  centeredText: {
    textAlign: 'center',
  },
  section: {
    gap: spacing.md,
  },
  sectionLabel: {
    textTransform: 'uppercase',
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    alignSelf: 'flex-start',
  },
  sectionHeaderRowPressed: {
    opacity: 0.7,
  },
  shelf: {
    gap: spacing.md,
  },
  seriesColumn: {
    gap: spacing.md,
  },
});
