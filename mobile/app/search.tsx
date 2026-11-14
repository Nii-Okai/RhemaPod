import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText, FittedArt, MediaRow, PlatformIcon, QueryState, RowPill } from '../components';
import { createThemedStyles, useTheme } from '../theme/ThemeContext';
import { spacing } from '../theme/spacing';
import { formatDuration } from '../lib/format/duration';
import { useDebouncedValue } from '../lib/hooks/useDebouncedValue';
import { SUGGEST_MIN_LENGTH, useSearchResults, useSearchSuggest } from '../lib/query/hooks/useSearch';
import { SearchRow } from './_search/SearchRow';
import type { components } from '../lib/api/schema';

type SermonListItem = components['schemas']['SermonListItem'];

/** "42:18 · Ada Nwosu" — same duration-then-speaker composition `SermonCard`'s own meta line uses. */
function sermonMeta(sermon: SermonListItem): string {
  const parts = [formatDuration(sermon.duration_seconds), sermon.speaker_name].filter(
    (part): part is string => Boolean(part),
  );
  return parts.join(' · ');
}

function episodeCountLabel(count: number): string {
  return count === 1 ? '1 episode' : `${count} episodes`;
}

const DEBOUNCE_MS = 300;

type Filter = 'all' | 'sermons' | 'series' | 'speakers';

/**
 * Search (Daybreak redesign, canvas B4). Live suggestions from `/search/suggest` and
 * grouped results from `/search`, both off the same debounced query (plan W4.3: an
 * undebounced box would self-throttle against the per-user rate limiter, L14).
 *
 * The field sits beside Cancel; once there is a query, filter chips (All, Sermons ·
 * N, Series · N, Speakers · N) narrow the list. Under All a matching series leads as the
 * "Top result" card, then each group is listed under a small heading with art, the query
 * marked in the title, and a meta line. Suggestions stay plain text rows above.
 *
 * This brings back the headings and thumbnails that an earlier flat-list pass took out
 * (Isaac, 2026-10-02), because the Daybreak mockup Nii approved has them.
 */
export default function SearchScreen() {
  const { colors } = useTheme();
  const styles = useStyles();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [rawQuery, setRawQuery] = useState('');
  const [focused, setFocused] = useState(false);
  const debouncedQuery = useDebouncedValue(rawQuery, DEBOUNCE_MS);
  const trimmed = debouncedQuery.trim();
  const hasQuery = rawQuery.trim().length > 0;

  const suggest = useSearchSuggest(trimmed);
  const results = useSearchResults({ q: trimmed || undefined }, { enabled: trimmed.length > 0 });

  const sermons = results.data?.results ?? [];
  const series = results.data?.series ?? [];
  const speakers = results.data?.speakers ?? [];
  const totalMatches = sermons.length + series.length + speakers.length;

  // Dropped once it's the query itself, or once a flat row for it already renders below
  // in a result group (Isaac's ask, session 2026-10-02 — the suggest endpoint can return
  // a phrase that's also an exact sermon/series/speaker title, which read as an outright
  // duplicate once suggestions and results became visually identical flat rows).
  const resultTitles = new Set<string>([
    ...sermons.map((sermon) => sermon.title.toLowerCase()),
    ...series.map((item) => item.title.toLowerCase()),
    ...speakers.map((speaker) => speaker.name.toLowerCase()),
  ]);
  const suggestions = (suggest.data ?? []).filter(
    (s) => s.toLowerCase() !== trimmed.toLowerCase() && !resultTitles.has(s.toLowerCase()),
  );

  function goToSermon(id: string) {
    router.push({ pathname: '/player/[id]', params: { id } });
  }

  function goToSeries(id: string) {
    router.push({ pathname: '/series/[id]', params: { id } });
  }

  function goToSpeaker(speaker: { id: string; name: string; bio: string | null; sermon_count: number }) {
    router.push({
      pathname: '/speaker/[id]',
      params: { id: speaker.id, name: speaker.name, bio: speaker.bio ?? '', sermonCount: String(speaker.sermon_count) },
    });
  }

  const [filter, setFilter] = useState<Filter>('all');
  const show = (group: Filter) => filter === 'all' || filter === group;
  // The top result: a series when one matches (it leads somewhere bigger), else the first sermon.
  const topSeries = filter === 'all' ? series[0] : undefined;
  const chips: { key: Filter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'sermons', label: sermons.length ? `Sermons · ${sermons.length}` : 'Sermons' },
    { key: 'series', label: series.length ? `Series · ${series.length}` : 'Series' },
    { key: 'speakers', label: speakers.length ? `Speakers · ${speakers.length}` : 'Speakers' },
  ];

  return (
    <View style={styles.screen}>
      {/* The live field with Cancel beside it (canvas B4). `app/_layout.tsx` pushes this
          route with `animation: 'none'`, so the field reads as the same one the Home and
          Discover search buttons stand for. */}
      <View style={[styles.searchBarWrap, { paddingTop: Math.max(insets.top, spacing.sm) + spacing.sm }]}>
        <View style={[styles.inputBox, focused && styles.inputBoxFocused]}>
          <PlatformIcon name="search" size={20} color={colors.text.tertiary} />
          <TextInput
            value={rawQuery}
            onChangeText={setRawQuery}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder="Search sermons, series, speakers"
            placeholderTextColor={colors.text.tertiary}
            selectionColor={colors.iris.fill}
            style={styles.input}
            accessibilityLabel="Search"
            autoCorrect={false}
            autoCapitalize="none"
            returnKeyType="search"
            // Isaac's ask, session 2026-10-02: the field is ready to type into the
            // instant the screen opens, no extra tap to focus it first.
            autoFocus
          />
          {hasQuery ? (
            <Pressable onPress={() => setRawQuery('')} accessibilityRole="button" accessibilityLabel="Clear search" hitSlop={spacing.sm}>
              <PlatformIcon name="close-circle" size={18} color={colors.text.tertiary} />
            </Pressable>
          ) : null}
        </View>
        <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Back" hitSlop={spacing.sm} style={styles.cancel}>
          <AppText variant="ui.bodyBold" tone="gold">
            Cancel
          </AppText>
        </Pressable>
      </View>

      {hasQuery ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} style={styles.chipsBar}>
          {chips.map((chip) => {
            const on = chip.key === filter;
            return (
              <Pressable
                key={chip.key}
                onPress={() => setFilter(chip.key)}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                style={[styles.chip, on && styles.chipOn]}
              >
                <AppText variant="ui.label" style={on ? styles.chipTextOn : styles.chipText}>
                  {chip.label}
                </AppText>
              </Pressable>
            );
          })}
        </ScrollView>
      ) : null}

      <ScrollView
        style={styles.results}
        contentContainerStyle={styles.resultsContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {!hasQuery ? (
          <View style={styles.prompt}>
            <AppText variant="display.row" style={styles.promptTitle}>
              Search the library
            </AppText>
            <AppText variant="ui.body" tone="secondary" style={styles.promptDescription}>
              Find sermons by title, speaker, or topic.
            </AppText>
          </View>
        ) : (
          <>
            {trimmed.length >= SUGGEST_MIN_LENGTH && suggestions.length > 0 ? (
              <View style={styles.section}>
                {suggestions.map((suggestion) => (
                  <SearchRow
                    key={suggestion}
                    label={suggestion}
                    accessibilityLabel={`Search for "${suggestion}"`}
                    onPress={() => setRawQuery(suggestion)}
                  />
                ))}
              </View>
            ) : null}

            <QueryState
              isLoading={results.isLoading}
              isError={results.isError}
              error={results.error}
              // Suggestions count as "something to show": without this guard a query with
              // live suggestions but zero matches showed both at once (Isaac's report).
              isEmpty={!results.isLoading && !results.isError && totalMatches === 0 && suggestions.length === 0}
              emptyTitle="No results match your search."
              emptyDescription="Try a different title, speaker, or topic."
              onRetry={() => results.refetch()}
              loadingLabel="Searching"
            >
              {topSeries ? (
                <View style={styles.section}>
                  <Eyebrow label="Top result" />
                  <Pressable
                    onPress={() => goToSeries(topSeries.id)}
                    accessibilityRole="button"
                    accessibilityLabel={`${topSeries.title}, series, ${episodeCountLabel(topSeries.episode_count)}`}
                    style={({ pressed }) => [styles.topCard, pressed && styles.pressed]}
                  >
                    <View style={styles.topArt}>
                      {topSeries.thumbnail_url ? <FittedArt uri={topSeries.thumbnail_url} /> : null}
                    </View>
                    <View style={styles.topText}>
                      <RowPill label="Series" tone="iris" />
                      <AppText variant="display.compact" numberOfLines={2}>
                        {topSeries.title}
                      </AppText>
                      <AppText variant="ui.badge" tone="tertiary">
                        {episodeCountLabel(topSeries.episode_count)}
                      </AppText>
                    </View>
                  </Pressable>
                </View>
              ) : null}

              {show('sermons') && sermons.length > 0 ? (
                <View style={styles.section}>
                  <Eyebrow label="Sermons" />
                  {sermons.map((sermon, i) => {
                    const meta = sermonMeta(sermon);
                    return (
                      <MediaRow
                        key={sermon.id}
                        title={sermon.title}
                        highlight={trimmed}
                        meta={meta}
                        thumbnailUrl={sermon.thumbnail_url}
                        accessibilityLabel={meta ? `${sermon.title}, ${meta}` : sermon.title}
                        divider={i < sermons.length - 1}
                        onPress={() => goToSermon(sermon.id)}
                        queueSermon={sermon}
                      />
                    );
                  })}
                </View>
              ) : null}

              {show('series') && series.slice(topSeries ? 1 : 0).length > 0 ? (
                <View style={styles.section}>
                  <Eyebrow label="Series" />
                  {series.slice(topSeries ? 1 : 0).map((item, i, list) => (
                    <MediaRow
                      key={item.id}
                      title={item.title}
                      highlight={trimmed}
                      meta={episodeCountLabel(item.episode_count)}
                      thumbnailUrl={item.thumbnail_url}
                      accessibilityLabel={`${item.title}, ${episodeCountLabel(item.episode_count)}`}
                      divider={i < list.length - 1}
                      onPress={() => goToSeries(item.id)}
                    />
                  ))}
                </View>
              ) : null}

              {show('speakers') && speakers.length > 0 ? (
                <View style={styles.section}>
                  <Eyebrow label="Speakers" />
                  {speakers.map((speaker, i) => (
                    <MediaRow
                      key={speaker.id}
                      title={speaker.name}
                      highlight={trimmed}
                      meta={speaker.sermon_count === 1 ? '1 sermon' : `${speaker.sermon_count} sermons`}
                      art={<Initials name={speaker.name} />}
                      accessibilityLabel={`${speaker.name}, ${speaker.bio ?? 'No bio yet'}`}
                      divider={i < speakers.length - 1}
                      onPress={() => goToSpeaker(speaker)}
                    />
                  ))}
                </View>
              ) : null}
            </QueryState>
          </>
        )}
      </ScrollView>
    </View>
  );
}

function Eyebrow({ label }: { label: string }) {
  const styles = useStyles();
  return (
    <AppText variant="ui.badge" tone="tertiary" style={styles.eyebrow}>
      {label.toUpperCase()}
    </AppText>
  );
}

function Initials({ name }: { name: string }) {
  const styles = useStyles();
  const letters = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(-2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
  return (
    <View style={styles.initials}>
      <AppText variant="display.compact" tone="inverse">
        {letters}
      </AppText>
    </View>
  );
}

const useStyles = createThemedStyles((colors) => ({
  screen: {
    flex: 1,
    backgroundColor: colors.surface.app,
  },
  searchBarWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg + 4,
  },
  inputBox: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 2,
    height: 54,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: colors.border.default,
    backgroundColor: colors.surface.raised,
    paddingHorizontal: spacing.lg,
  },
  inputBoxFocused: {
    borderColor: colors.iris.fill,
  },
  input: {
    flex: 1,
    color: colors.text.primary,
    fontSize: 16,
    paddingVertical: spacing.xs,
  },
  cancel: {
    paddingVertical: spacing.md,
  },
  chipsBar: {
    flexGrow: 0,
  },
  chips: {
    gap: spacing.sm,
    paddingHorizontal: spacing.lg + 4,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xs,
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
  results: {
    flex: 1,
  },
  resultsContent: {
    paddingHorizontal: spacing.lg + 4,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xxl * 2,
    gap: spacing.xl,
  },
  prompt: {
    paddingTop: spacing.xxl,
    alignItems: 'center',
    gap: spacing.xs,
  },
  promptTitle: {
    textAlign: 'center',
  },
  promptDescription: {
    textAlign: 'center',
  },
  section: {
    gap: spacing.xs,
  },
  eyebrow: {
    letterSpacing: 1.5,
    marginBottom: spacing.xs,
  },
  pressed: {
    opacity: 0.8,
  },
  topCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md + 2,
    padding: spacing.md,
    borderRadius: 24,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border.default,
    backgroundColor: colors.surface.raised,
  },
  topArt: {
    width: 84,
    height: 84,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: colors.surface.sunken,
  },
  topText: {
    flex: 1,
    gap: 6,
  },
  initials: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primaryButton.bg,
  },
}));
