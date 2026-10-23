import React, { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText, Avatar, PlatformIcon, PressableScale, QueryState } from '../../../../components';
import { createThemedStyles, useTheme } from '../../../../theme/ThemeContext';
import { radius } from '../../../../theme/radius';
import { spacing } from '../../../../theme/spacing';
import { formatDuration } from '../../../../lib/format/duration';
import { useDebouncedValue } from '../../../../lib/hooks/useDebouncedValue';
import { useCategories } from '../../../../lib/query/hooks/useCategories';
import { useProphetsCatalog } from '../../../../lib/query/hooks/useProphetsCatalog';
import { useSearchResults } from '../../../../lib/query/hooks/useSearch';
import { useSpeakers, type Speaker } from '../../../../lib/query/hooks/useSpeakers';
import { LEAF_SM } from '../../_home/signature/leaf';
import { CatalogCollectionCard } from './CatalogCollectionCard';
import { ResultRow } from './ResultRow';
import { TopicTile, topicTones } from './TopicTile';
import { usePullToRefresh } from '../../../../lib/hooks/usePullToRefresh';

// Same as the classic Browse: a short grid with "See more" under it.
const COLLAPSED_CATEGORY_COUNT = 6;
const GRID_COLUMNS = 2;
// Same debounce as the search screen, for the same per-user rate limit.
const DEBOUNCE_MS = 300;

function chunk<T>(items: T[], size: number): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += size) rows.push(items.slice(i, i + size));
  return rows;
}

function episodeCountLabel(count: number): string {
  return count === 1 ? '1 episode' : `${count} episodes`;
}

function joinMeta(parts: (string | null | undefined)[]): string {
  return parts
    .filter((part): part is string => Boolean(part))
    .join(' · ')
    .toUpperCase();
}

/**
 * Browse, Signature redesign (Nii's approved mockup "RhemaPod — Signature", 2026-10-21),
 * behind `SIGNATURE_BROWSE_ENABLED`.
 *
 * Search lives on the page instead of behind a pushed `/search` screen, and it is never
 * blank: with nothing typed, the page under the field is Browse itself (Prophet's
 * Catalog, the categories, the speaker); once something is typed, live results from the
 * same `/search` read replace it. Everything else is the classic Browse's data and
 * destinations — categories open `/category/[id]`, speakers `/speaker/[id]`.
 *
 * The mockup's recent-search chips are left out: the app keeps no search history yet.
 */
export function SignatureBrowseScreen() {
  const { colors } = useTheme();
  const styles = useStyles();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const categories = useCategories();
  const speakers = useSpeakers();
  const prophetsCatalog = useProphetsCatalog();
  const pullToRefresh = usePullToRefresh([categories, speakers, prophetsCatalog]);
  const [rawQuery, setRawQuery] = useState('');
  const [showAllCategories, setShowAllCategories] = useState(false);

  const debouncedQuery = useDebouncedValue(rawQuery, DEBOUNCE_MS);
  const trimmed = debouncedQuery.trim();
  const hasQuery = rawQuery.trim().length > 0;
  const results = useSearchResults({ q: trimmed || undefined }, { enabled: trimmed.length > 0 });

  const allCategories = categories.data ?? [];
  const hasMoreCategories = allCategories.length > COLLAPSED_CATEGORY_COUNT;
  const visibleCategories =
    showAllCategories || !hasMoreCategories ? allCategories : allCategories.slice(0, COLLAPSED_CATEGORY_COUNT);
  const tones = topicTones(colors);
  const speakerList = speakers.data ?? [];
  const catalogLead = prophetsCatalog.data?.[0];

  const sermonHits = results.data?.results ?? [];
  const seriesHits = results.data?.series ?? [];
  const speakerHits = results.data?.speakers ?? [];
  const totalHits = sermonHits.length + seriesHits.length + speakerHits.length;
  // Results for an older query stay up while the debounce catches up to the field.
  const settling = trimmed !== rawQuery.trim();

  const goToSermon = (id: string) => router.push({ pathname: '/player/[id]', params: { id } });
  const goToSeries = (id: string) => router.push({ pathname: '/series/[id]', params: { id } });
  const goToSpeaker = (speaker: Speaker) =>
    router.push({
      pathname: '/speaker/[id]',
      params: {
        id: speaker.id,
        name: speaker.name,
        bio: speaker.bio ?? '',
        sermonCount: String(speaker.sermon_count),
      },
    });

  return (
    <View style={[styles.screen, { paddingTop: Math.max(insets.top, spacing.lg) }]}>
      <View style={styles.header}>
        <AppText variant="display.hero" accessibilityRole="header">
          Browse
        </AppText>
        <View style={styles.field}>
          <PlatformIcon name="search" size={20} color={colors.text.secondary} />
          <TextInput
            value={rawQuery}
            onChangeText={setRawQuery}
            placeholder="Search sermons, series, speakers"
            placeholderTextColor={colors.text.secondary}
            style={styles.input}
            accessibilityLabel="Search sermons, series, speakers"
            autoCorrect={false}
            autoCapitalize="none"
            returnKeyType="search"
          />
          {rawQuery.length > 0 ? (
            <Pressable
              onPress={() => setRawQuery('')}
              accessibilityRole="button"
              accessibilityLabel="Clear search"
              hitSlop={spacing.sm}
            >
              <PlatformIcon name="close-circle" size={20} color={colors.text.tertiary} />
            </Pressable>
          ) : null}
        </View>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl {...pullToRefresh} />}
      >
        {hasQuery ? (
          <View style={styles.gutter}>
            <QueryState
              isLoading={results.isLoading || (settling && !results.data)}
              isError={results.isError}
              error={results.error}
              isEmpty={!settling && totalHits === 0}
              emptyTitle={`Nothing for “${trimmed}” yet`}
              emptyDescription={
                allCategories[0]
                  ? `Try a series name or a category like ${allCategories[0].name}.`
                  : 'Try a series name or a speaker.'
              }
              onRetry={() => results.refetch()}
              loadingLabel="Searching"
            >
              <View>
                {sermonHits.map((sermon) => (
                  <ResultRow
                    key={`sermon-${sermon.id}`}
                    title={sermon.title}
                    meta={joinMeta([
                      'Sermon',
                      sermon.category_name,
                      sermon.duration_seconds ? formatDuration(sermon.duration_seconds) : null,
                    ])}
                    thumbnailUrl={sermon.thumbnail_url}
                    onPress={() => goToSermon(sermon.id)}
                  />
                ))}
                {seriesHits.map((item) => (
                  <ResultRow
                    key={`series-${item.id}`}
                    title={item.title}
                    meta={joinMeta(['Series', episodeCountLabel(item.episode_count)])}
                    thumbnailUrl={item.thumbnail_url}
                    onPress={() => goToSeries(item.id)}
                  />
                ))}
                {speakerHits.map((speaker) => (
                  <ResultRow
                    key={`speaker-${speaker.id}`}
                    title={speaker.name}
                    meta={joinMeta(['Speaker'])}
                    art={<Avatar name={speaker.name} seed={speaker.id} size={40} />}
                    onPress={() => goToSpeaker(speaker)}
                  />
                ))}
              </View>
            </QueryState>
          </View>
        ) : (
          <>
            {catalogLead ? (
              <View style={styles.gutter}>
                <CatalogCollectionCard leadTitle={catalogLead.title} onPress={() => goToSermon(catalogLead.id)} />
              </View>
            ) : null}

            <View style={[styles.section, styles.gutter]}>
              <AppText variant="display.section" accessibilityRole="header">
                Categories
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
                  {chunk(visibleCategories, GRID_COLUMNS).map((row, rowIndex) => (
                    <View key={row[0].id} style={styles.gridRow}>
                      {Array.from({ length: GRID_COLUMNS }, (_, i) => row[i]).map((category, i) => (
                        <View key={category?.id ?? `empty-${i}`} style={styles.gridCell}>
                          {category ? (
                            <TopicTile
                              category={category}
                              tone={tones[(rowIndex * GRID_COLUMNS + i) % tones.length]}
                              onPress={() =>
                                router.push({
                                  pathname: '/category/[id]',
                                  params: {
                                    id: category.id,
                                    name: category.name,
                                  },
                                })
                              }
                            />
                          ) : null}
                        </View>
                      ))}
                    </View>
                  ))}
                </View>
                {hasMoreCategories ? (
                  <Pressable
                    onPress={() => setShowAllCategories((current) => !current)}
                    accessibilityRole="button"
                    accessibilityLabel={showAllCategories ? 'See fewer categories' : 'See more categories'}
                    style={({ pressed }) => [styles.seeMore, pressed && styles.pressed]}
                  >
                    <AppText variant="ui.button">{showAllCategories ? 'See less' : 'See more'}</AppText>
                    <PlatformIcon
                      name={showAllCategories ? 'chevron-up' : 'chevron-down'}
                      size={18}
                      color={colors.text.primary}
                    />
                  </Pressable>
                ) : null}
              </QueryState>
            </View>

            <View style={[styles.section, styles.gutter]}>
              <AppText variant="display.section" accessibilityRole="header">
                {speakerList.length > 1 ? 'Speakers' : 'Speaker'}
              </AppText>
              <QueryState
                isLoading={speakers.isLoading}
                isError={speakers.isError}
                error={speakers.error}
                isEmpty={!speakers.isLoading && !speakers.isError && speakerList.length === 0}
                emptyTitle="No speakers yet"
                emptyDescription="Check back once the catalogue has speakers."
                onRetry={() => speakers.refetch()}
                loadingLabel="Loading speakers"
              >
                <View style={styles.speakers}>
                  {speakerList.map((speaker) => (
                    <PressableScale
                      key={speaker.id}
                      onPress={() => goToSpeaker(speaker)}
                      accessibilityRole="button"
                      accessibilityLabel={`${speaker.name}, ${speaker.bio ?? 'No bio yet'}`}
                      style={[styles.speakerCard, LEAF_SM]}
                    >
                      <View style={styles.avatarRing}>
                        <Avatar name={speaker.name} seed={speaker.id} size={48} />
                      </View>
                      <View style={styles.speakerText}>
                        <AppText variant="ui.bodyLarge" numberOfLines={1}>
                          {speaker.name}
                        </AppText>
                        <AppText variant="ui.body" tone="secondary" numberOfLines={1}>
                          {speaker.bio ?? 'No bio yet'}
                        </AppText>
                      </View>
                      <PlatformIcon name="chevron-forward" size={20} color={colors.text.tertiary} />
                    </PressableScale>
                  ))}
                </View>
              </QueryState>
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const useStyles = createThemedStyles((colors) => ({
  screen: {
    flex: 1,
    backgroundColor: colors.surface.app,
  },
  header: {
    gap: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
  },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    height: 48,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border.default,
    backgroundColor: colors.surface.raised,
  },
  input: {
    flex: 1,
    color: colors.text.primary,
    fontSize: 16,
    paddingVertical: spacing.xs,
  },
  scroll: {
    flex: 1,
  },
  content: {
    paddingTop: spacing.lg,
    paddingBottom: spacing.xxl * 2,
    gap: spacing.xxl + spacing.sm,
  },
  gutter: {
    paddingHorizontal: spacing.lg,
  },
  section: {
    gap: spacing.md,
  },
  grid: {
    gap: spacing.sm,
  },
  gridRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  gridCell: {
    flex: 1,
  },
  seeMore: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    gap: spacing.xs,
    minHeight: 44,
    paddingHorizontal: spacing.lg,
  },
  pressed: {
    opacity: 0.7,
  },
  speakers: {
    gap: spacing.sm,
  },
  speakerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border.default,
    backgroundColor: colors.surface.raised,
  },
  avatarRing: {
    padding: 2,
    borderRadius: 28,
    borderWidth: 2,
    borderColor: colors.accent.gold,
  },
  speakerText: {
    flex: 1,
    gap: 2,
  },
}));
