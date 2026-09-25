import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { AppText } from '../../components';
import { colors } from '../../theme/colors';
import { spacing } from '../../theme/spacing';
import { ApiError } from '../../lib/api/errors';
import { useSermons } from '../../lib/query/hooks/useSermons';
import { useContinueWatching } from '../../lib/query/hooks/useContinueWatching';
import { useSeriesList } from '../../lib/query/hooks/useSeries';
import { pathnameFor, routeByKey } from '../../components/navigation/routes';
import { AnnouncementsEntry } from './_home/AnnouncementsEntry';
import { ContinueWatchingCard } from './_home/ContinueWatchingCard';
import { HeroCard } from './_home/HeroCard';
import { HeroSkeleton } from './_home/HeroSkeleton';
import { SectionError } from './_home/SectionError';
import { SeriesCard } from './_home/SeriesCard';
import { ShelfSkeleton } from './_home/ShelfSkeleton';

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return 'Something went wrong. Try again.';
}

const ANNOUNCEMENTS_PATH = pathnameFor(routeByKey('announcements'));

/**
 * Home (design spec §3 Home / 1b iOS / 2a Android): hero (P5 — first item of
 * `GET /catalog/sermons`, server-ordered newest-published-first, no client pin) +
 * "Continue watching" shelf (omitted entirely when empty — the spec shows no
 * empty-state card for it) + "Series" shelf + the P2 Announcements entry point. No
 * platform-chrome fork lives in this screen's own content — the base spec describes
 * Home's iOS/Android variants as the same content model, chrome-only differences that
 * `NavShell` (W3.4) already owns; §8.5's top-app-bar swap is specific to the detail
 * screen, not this one.
 */
export default function HomeScreen() {
  const router = useRouter();
  const sermons = useSermons();
  const continueWatching = useContinueWatching();
  const series = useSeriesList();

  const hero = sermons.data?.[0];
  const continueWatchingItems = continueWatching.data ?? [];
  const seriesItems = series.data ?? [];

  const goToSermon = (id: string) => router.push({ pathname: '/sermon/[id]', params: { id } });
  // W4.4 owns `/series/[id]`'s screen — this is only the navigation call, per the
  // Conductor's decision not to create that route file here.
  const goToSeries = (id: string) => router.push({ pathname: '/series/[id]', params: { id } });
  const goToAnnouncements = () => router.push(ANNOUNCEMENTS_PATH);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      {sermons.isLoading ? (
        <HeroSkeleton />
      ) : sermons.isError ? (
        <SectionError message={errorMessage(sermons.error)} onRetry={() => sermons.refetch()} />
      ) : hero ? (
        <HeroCard sermon={hero} onPress={() => goToSermon(hero.id)} />
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

      <AnnouncementsEntry onPress={goToAnnouncements} />

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
          <SectionError message={errorMessage(continueWatching.error)} onRetry={() => continueWatching.refetch()} />
        </View>
      ) : continueWatchingItems.length > 0 ? (
        <View style={styles.section}>
          <AppText variant="ui.label" tone="secondary" style={styles.sectionLabel}>
            continue watching
          </AppText>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.shelf}>
            {continueWatchingItems.map((item) => (
              <ContinueWatchingCard key={item.id} item={item} onPress={() => goToSermon(item.id)} />
            ))}
          </ScrollView>
        </View>
      ) : null}

      <View style={styles.section}>
        <AppText variant="ui.label" tone="secondary" style={styles.sectionLabel}>
          series
        </AppText>
        {series.isLoading ? (
          <ShelfSkeleton loadingLabel="Loading series" />
        ) : series.isError ? (
          <SectionError message={errorMessage(series.error)} onRetry={() => series.refetch()} />
        ) : seriesItems.length === 0 ? (
          <AppText variant="ui.body" tone="secondary">
            No series yet — check back once the catalogue has one.
          </AppText>
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.shelf}>
            {seriesItems.map((item) => (
              <SeriesCard key={item.id} series={item} onPress={() => goToSeries(item.id)} />
            ))}
          </ScrollView>
        )}
      </View>
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
  shelf: {
    gap: spacing.md,
  },
});
