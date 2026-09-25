import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { AppText, QueryState } from '../../components';
import { colors } from '../../theme/colors';
import { spacing } from '../../theme/spacing';
import { usePlatformOS } from '../../components/navigation/platform';
import { useCategories } from '../../lib/query/hooks/useCategories';
import { useSpeakers } from '../../lib/query/hooks/useSpeakers';
import { AndroidSearchEntry } from './_browse/AndroidSearchEntry';
import { CategoryCard } from './_browse/CategoryCard';
import { SpeakerListRow } from './_browse/SpeakerListRow';

/**
 * Design spec 1i/2d: flat categories and speakers — "the two axes people
 * actually browse by: topic and voice" (plan W4.3). Android additionally
 * gets the M3 search-bar entry point at the top (L3: both chromes ship in
 * this slice, not iOS first then a later Android pass).
 *
 * Each `CategoryPublic`/`SpeakerPublic` already carries its `sermon_count`
 * computed server-side — this screen never fans out a per-row count request.
 */
export default function BrowseScreen() {
  const router = useRouter();
  const os = usePlatformOS();
  const categories = useCategories();
  const speakers = useSpeakers();

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <AppText variant="display.section" style={styles.heading}>
        Browse
      </AppText>

      {os === 'android' ? (
        <AndroidSearchEntry onPress={() => router.push('/search')} />
      ) : null}

      <View style={styles.section}>
        <AppText variant="ui.label" tone="secondary" style={styles.sectionLabel}>
          categories
        </AppText>
        <QueryState
          isLoading={categories.isLoading}
          isError={categories.isError}
          error={categories.error}
          isEmpty={!categories.isLoading && !categories.isError && (categories.data?.length ?? 0) === 0}
          emptyTitle="No categories yet"
          emptyDescription="Check back once the catalogue has categories."
          onRetry={() => categories.refetch()}
          loadingLabel="Loading categories"
        >
          {(categories.data ?? []).map((category) => (
            <CategoryCard
              key={category.id}
              category={category}
              onPress={() =>
                router.push({
                  pathname: '/category/[id]',
                  params: { id: category.id, name: category.name },
                })
              }
            />
          ))}
        </QueryState>
      </View>

      <View style={styles.section}>
        <AppText variant="ui.label" tone="secondary" style={styles.sectionLabel}>
          speakers
        </AppText>
        <QueryState
          isLoading={speakers.isLoading}
          isError={speakers.isError}
          error={speakers.error}
          isEmpty={!speakers.isLoading && !speakers.isError && (speakers.data?.length ?? 0) === 0}
          emptyTitle="No speakers yet"
          emptyDescription="Check back once the catalogue has speakers."
          onRetry={() => speakers.refetch()}
          loadingLabel="Loading speakers"
        >
          {(speakers.data ?? []).map((speaker) => (
            <SpeakerListRow
              key={speaker.id}
              speaker={speaker}
              onPress={() =>
                router.push({
                  pathname: '/speaker/[id]',
                  // `bio` travels with the nav params rather than a second fetch — the
                  // list row (useSpeakers) already has the full SpeakerPublic in hand.
                  params: { id: speaker.id, name: speaker.name, bio: speaker.bio ?? '' },
                })
              }
            />
          ))}
        </QueryState>
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
  },
  heading: {
    marginBottom: spacing.lg,
  },
  section: {
    marginBottom: spacing.xxl,
  },
  sectionLabel: {
    textTransform: 'uppercase',
    marginBottom: spacing.md,
  },
});
