import React, { useState } from 'react';
import { ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { AppText, LinkButton, QueryState } from '../../components';
import { SermonResultRow } from '../../components/sermon/SermonResultRow';
import { SpeakerListRow } from './_browse/SpeakerListRow';
import { SeriesListCard } from './_series/SeriesListCard';
import { colors } from '../../theme/colors';
import { spacing } from '../../theme/spacing';
import { useDebouncedValue } from '../../lib/hooks/useDebouncedValue';
import { SUGGEST_MIN_LENGTH, useSearchResults, useSearchSuggest } from '../../lib/query/hooks/useSearch';
import { SuggestionRow } from './_search/SuggestionRow';

const DEBOUNCE_MS = 300;

/**
 * Design spec 1j: live suggestions from `/search/suggest` plus grouped
 * results from `/search`, both driven off the same debounced query (plan
 * W4.3 — an undebounced box would self-throttle against the per-user rate
 * limiter, L14).
 *
 * Decision 4: `/search` now returns `series`/`speakers` alongside the
 * sermon `results`, so this renders three grouped sections (sermons /
 * series / speakers) instead of sermons-only. Each group's label shows the
 * count of rows actually rendered here (not the backend's uncapped
 * `series_total`/`speakers_total`) — same convention the sermons group
 * label already used pre-Decision-4 (rendered count, not the paginated
 * `total`). A group section is omitted entirely when it has no matches,
 * rather than rendering an empty "series · 0" header.
 */
export default function SearchScreen() {
  const router = useRouter();
  const [rawQuery, setRawQuery] = useState('');
  const debouncedQuery = useDebouncedValue(rawQuery, DEBOUNCE_MS);
  const trimmed = debouncedQuery.trim();
  const hasQuery = rawQuery.trim().length > 0;

  const suggest = useSearchSuggest(trimmed);
  const results = useSearchResults({ q: trimmed || undefined }, { enabled: trimmed.length > 0 });

  const suggestions = (suggest.data ?? []).filter((s) => s.toLowerCase() !== trimmed.toLowerCase());

  const sermons = results.data?.results ?? [];
  const series = results.data?.series ?? [];
  const speakers = results.data?.speakers ?? [];
  const totalMatches = sermons.length + series.length + speakers.length;

  function goToSermon(id: string) {
    router.push({ pathname: '/sermon/[id]', params: { id } });
  }

  function goToSeries(id: string) {
    router.push({ pathname: '/series/[id]', params: { id } });
  }

  function goToSpeaker(speaker: { id: string; name: string; bio: string | null }) {
    router.push({
      pathname: '/speaker/[id]',
      params: { id: speaker.id, name: speaker.name, bio: speaker.bio ?? '' },
    });
  }

  return (
    <View style={styles.screen}>
      <View style={styles.inputRow}>
        <Ionicons name="search" size={18} color={colors.text.tertiary} />
        <TextInput
          value={rawQuery}
          onChangeText={setRawQuery}
          placeholder="Search sermons, series, speakers"
          placeholderTextColor={colors.text.tertiary}
          style={styles.input}
          accessibilityLabel="Search"
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
        />
        {hasQuery ? (
          <LinkButton label="Cancel" onPress={() => setRawQuery('')} accessibilityLabel="Clear search" />
        ) : null}
      </View>

      <ScrollView style={styles.results} contentContainerStyle={styles.resultsContent} keyboardShouldPersistTaps="handled">
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
                  <SuggestionRow key={suggestion} suggestion={suggestion} onPress={() => setRawQuery(suggestion)} />
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
                    <AppText variant="mono.meta" tone="tertiary" style={styles.groupLabel}>
                      sermons · {sermons.length}
                    </AppText>
                    {sermons.map((sermon) => (
                      <SermonResultRow key={sermon.id} sermon={sermon} onPress={() => goToSermon(sermon.id)} />
                    ))}
                  </View>
                ) : null}

                {series.length > 0 ? (
                  <View style={styles.group}>
                    <AppText variant="mono.meta" tone="tertiary" style={styles.groupLabel}>
                      series · {series.length}
                    </AppText>
                    {series.map((item) => (
                      <SeriesListCard key={item.id} series={item} onPress={() => goToSeries(item.id)} />
                    ))}
                  </View>
                ) : null}

                {speakers.length > 0 ? (
                  <View style={styles.group}>
                    <AppText variant="mono.meta" tone="tertiary" style={styles.groupLabel}>
                      speakers · {speakers.length}
                    </AppText>
                    {speakers.map((speaker) => (
                      <SpeakerListRow key={speaker.id} speaker={speaker} onPress={() => goToSpeaker(speaker)} />
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
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border.default,
  },
  input: {
    flex: 1,
    color: colors.text.primary,
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
  groupLabel: {
    textTransform: 'uppercase',
    marginBottom: spacing.sm,
  },
});
