import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText, IconButton, PlatformIcon, QueryState } from '../components';
import { colors } from '../theme/colors';
import { radius } from '../theme/radius';
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

/**
 * Design spec 1j: live suggestions from `/search/suggest` plus grouped
 * results from `/search`, both driven off the same debounced query (plan
 * W4.3 — an undebounced box would self-throttle against the per-user rate
 * limiter, L14).
 *
 * Decision 4: `/search` now returns `series`/`speakers` alongside the
 * sermon `results`, so this still renders sermons/series/speakers as three
 * internally-ordered groups, but with no visible "sermons · N" label above
 * each one (Isaac's ask, session 2026-10-02 — "only show search results
 * without headings") — a group that has no matches just contributes no rows,
 * same as before this label was removed.
 *
 * Every row — suggestions and all three result groups alike — renders as a plain
 * `SearchRow` (title + hairline divider, Isaac's ask, session 2026-10-02: a flat list
 * matching the Prime Video reference), not the richer thumbnail/avatar rows
 * `SermonCard`/`SeriesListCard`/`SpeakerListRow` still render elsewhere (category/
 * speaker drill-down, the all-series page, Browse). The dropped detail (duration,
 * speaker, episode count, bio) still reaches VoiceOver via each row's `accessibilityLabel`.
 */
export default function SearchScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [rawQuery, setRawQuery] = useState('');
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
    router.push({ pathname: '/sermon/[id]', params: { id } });
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

  return (
    <View style={styles.screen}>
      <View style={[styles.backRow, { paddingTop: Math.max(insets.top, spacing.sm) }]}>
        <IconButton icon="chevron-back" accessibilityLabel="Back" onPress={() => router.back()} />
      </View>
      {/* Same pill position/style as Browse's own search entry (Isaac's ask, session
          2026-10-02) — `BrowseSearchEntry`'s bar is a non-interactive Pressable that
          lands here; this is the live, editable version of that same field, which is why
          `app/_layout.tsx` pushes this route with `animation: 'none'` — the field itself
          visually continues from the same spot rather than sliding in as a new screen. */}
      <View style={styles.searchBarWrap}>
        <View style={styles.inputPill}>
          <PlatformIcon name="search" size={18} color={colors.primaryButton.text} style={styles.inputIcon} />
          <TextInput
            value={rawQuery}
            onChangeText={setRawQuery}
            placeholder="Search sermons, series, speakers"
            placeholderTextColor={colors.text.secondary}
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
            <Pressable onPress={() => setRawQuery('')} accessibilityRole="button" accessibilityLabel="Clear search">
              <PlatformIcon name="close-circle" size={18} color={colors.primaryButton.text} style={styles.inputIcon} />
            </Pressable>
          ) : null}
        </View>
      </View>

      <ScrollView
        style={styles.results}
        contentContainerStyle={styles.resultsContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {!hasQuery ? (
          <View style={styles.prompt}>
            <AppText variant="ui.bodyLarge" style={styles.promptTitle}>
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

            <View style={styles.section}>
              <QueryState
                isLoading={results.isLoading}
                isError={results.isError}
                error={results.error}
                isEmpty={!results.isLoading && !results.isError && totalMatches === 0}
                emptyTitle="No results match your search."
                emptyDescription="Try a different title, speaker, or topic."
                onRetry={() => results.refetch()}
                loadingLabel="Searching"
              >
                {sermons.length > 0 ? (
                  <View style={styles.group}>
                    {sermons.map((sermon) => {
                      const meta = sermonMeta(sermon);
                      return (
                        <SearchRow
                          key={sermon.id}
                          label={sermon.title}
                          accessibilityLabel={meta ? `${sermon.title}, ${meta}` : sermon.title}
                          onPress={() => goToSermon(sermon.id)}
                        />
                      );
                    })}
                  </View>
                ) : null}

                {series.length > 0 ? (
                  <View style={styles.group}>
                    {series.map((item) => (
                      <SearchRow
                        key={item.id}
                        label={item.title}
                        accessibilityLabel={`${item.title}, ${episodeCountLabel(item.episode_count)}`}
                        onPress={() => goToSeries(item.id)}
                      />
                    ))}
                  </View>
                ) : null}

                {speakers.length > 0 ? (
                  <View style={styles.group}>
                    {speakers.map((speaker) => (
                      <SearchRow
                        key={speaker.id}
                        label={speaker.name}
                        accessibilityLabel={`${speaker.name}, ${speaker.bio ?? 'No bio yet'}`}
                        onPress={() => goToSpeaker(speaker)}
                      />
                    ))}
                  </View>
                ) : null}
              </QueryState>
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.surface.app,
  },
  // `flexDirection: 'row'` keeps the IconButton at its own intrinsic (left-aligned)
  // width — without it the bare View stretches to the full row width and its centered
  // icon reads as dead-center at the top of the screen instead of top-left, same corner
  // every other back control in the app (series.tsx's own header, CastCloseHeader) uses.
  backRow: {
    flexDirection: 'row',
    paddingHorizontal: spacing.xs,
  },
  searchBarWrap: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
  },
  inputPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.primaryButton.bg,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  inputIcon: {
    opacity: 0.6,
  },
  input: {
    flex: 1,
    color: colors.primaryButton.text,
    fontSize: 16,
    paddingVertical: spacing.xs,
  },
  results: {
    flex: 1,
  },
  resultsContent: {
    padding: spacing.lg,
    paddingBottom: spacing.xxl * 2,
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
    marginBottom: spacing.lg,
  },
  group: {
    marginBottom: spacing.lg,
  },
});
