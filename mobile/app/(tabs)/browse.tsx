import React, { useState } from 'react';
import { Pressable, ScrollView, useWindowDimensions, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText, PlatformIcon, QueryState, SpeakerListRow } from '../../components';
import { createThemedStyles, useTheme } from '../../theme/ThemeContext';
import { spacing } from '../../theme/spacing';
import { useCategories } from '../../lib/query/hooks/useCategories';
import { useSpeakers } from '../../lib/query/hooks/useSpeakers';
import { BrowseSearchEntry } from './_browse/BrowseSearchEntry';
import { CategoryCard } from './_browse/CategoryCard';
import { SignatureBrowseScreen } from './_browse/signature/SignatureBrowse';
import { SIGNATURE_BROWSE_ENABLED } from '../../lib/featureFlags';

const GRID_COLUMNS = 2;
// Isaac's ask, session 2026-10-02: more breathing room between category tiles.
const GRID_GAP = spacing.lg;
const GRID_PADDING = spacing.lg;
// Prime Video reference (Isaac's ask, session 2026-10-02): a short grid with a "See
// more" toggle underneath, not every category laid out at once.
const COLLAPSED_CATEGORY_COUNT = 6;

export default function BrowseScreen() {
  // Signature redesign rollout (Nii's plan, 2026-10-21): the flag is a build-time
  // constant, so this never switches between the two within one run.
  return SIGNATURE_BROWSE_ENABLED ? <SignatureBrowseScreen /> : <ClassicBrowseScreen />;
}

/**
 * Design spec 1i/2d: flat categories and speakers — "the two axes people
 * actually browse by: topic and voice" (plan W4.3).
 *
 * Browse is also the sole search entry point as of Isaac's ask, session 2026-10-02 (Prime
 * Video reference screenshots): the dedicated Search tab is gone, so `BrowseSearchEntry`
 * now renders unconditionally (it used to be Android-only, iOS reaching Search purely
 * via its own tab bar item) and pushes `/search` — a top-level stack route, not a tab.
 *
 * Each `CategoryPublic`/`SpeakerPublic` already carries its `sermon_count` computed
 * server-side — this screen never fans out a per-row count request.
 */
function ClassicBrowseScreen() {
  const { colors } = useTheme();
  const styles = useStyles();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const categories = useCategories();
  const speakers = useSpeakers();
  const [showAllCategories, setShowAllCategories] = useState(false);

  const allCategories = categories.data ?? [];
  const hasMoreCategories = allCategories.length > COLLAPSED_CATEGORY_COUNT;
  const visibleCategories =
    showAllCategories || !hasMoreCategories ? allCategories : allCategories.slice(0, COLLAPSED_CATEGORY_COUNT);
  const cardWidth = (windowWidth - GRID_PADDING * 2 - GRID_GAP * (GRID_COLUMNS - 1)) / GRID_COLUMNS;

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.content, { paddingTop: Math.max(insets.top, spacing.lg) }]}
      showsVerticalScrollIndicator={false}
    >
      <AppText variant="display.section" style={styles.heading}>
        Browse
      </AppText>

      <View style={styles.searchEntry}>
        <BrowseSearchEntry onPress={() => router.push('/search')} />
      </View>

      <View style={styles.section}>
        <AppText variant="ui.label" tone="secondary" style={styles.sectionLabel}>
          categories
        </AppText>
        <QueryState
          isLoading={categories.isLoading}
          isError={categories.isError}
          error={categories.error}
          isEmpty={!categories.isLoading && !categories.isError && allCategories.length === 0}
          emptyTitle="No categories yet"
          emptyDescription="Check back once the catalogue has categories."
          onRetry={() => categories.refetch()}
          loadingLabel="Loading categories"
        >
          <View style={styles.grid}>
            {visibleCategories.map((category) => (
              <CategoryCard
                key={category.id}
                category={category}
                width={cardWidth}
                onPress={() =>
                  router.push({
                    pathname: '/category/[id]',
                    params: { id: category.id, name: category.name },
                  })
                }
              />
            ))}
          </View>
          {hasMoreCategories ? (
            <Pressable
              onPress={() => setShowAllCategories((current) => !current)}
              accessibilityRole="button"
              accessibilityLabel={showAllCategories ? 'See fewer categories' : 'See more categories'}
              style={({ pressed }) => [styles.seeMore, pressed && styles.seeMorePressed]}
            >
              <AppText variant="ui.bodyLarge">{showAllCategories ? 'See less' : 'See more'}</AppText>
              <PlatformIcon
                name={showAllCategories ? 'chevron-up' : 'chevron-down'}
                size={18}
                color={colors.text.primary}
              />
            </Pressable>
          ) : null}
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
                  // `bio`/`sermonCount` travel with the nav params rather than a second
                  // fetch — the list row (useSpeakers) already has the full SpeakerPublic
                  // in hand.
                  params: {
                    id: speaker.id,
                    name: speaker.name,
                    bio: speaker.bio ?? '',
                    sermonCount: String(speaker.sermon_count),
                  },
                })
              }
            />
          ))}
        </QueryState>
      </View>
    </ScrollView>
  );
}

const useStyles = createThemedStyles((colors) => ({
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
  searchEntry: {
    marginBottom: spacing.lg,
  },
  section: {
    marginBottom: spacing.xxl,
  },
  sectionLabel: {
    textTransform: 'uppercase',
    marginBottom: spacing.md,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: GRID_GAP,
  },
  seeMore: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.md,
  },
  seeMorePressed: {
    opacity: 0.7,
  },
}));
