import React from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { AppText, QueryState } from '../../components';
import { SermonResultRow } from '../../components/sermon/SermonResultRow';
import { colors } from '../../theme/colors';
import { spacing } from '../../theme/spacing';
import { useSearchResults } from '../../lib/query/hooks/useSearch';

/**
 * Category drill-down list — reached by tapping a category card on Browse.
 * No screen is drawn for this destination in the design spec (only the
 * Browse card that links to it), so this reuses `/search` as a filtered
 * browse (`category_id`, no `q` — the endpoint's own documented mode) and
 * renders the same `SermonResultRow` the Search tab uses.
 */
export default function CategoryDrillDownScreen() {
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();
  const router = useRouter();
  const results = useSearchResults({ category_id: id });

  return (
    <>
      <Stack.Screen options={{ title: name || 'Category' }} />
      <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
        <AppText variant="display.section" style={styles.heading}>
          {name || 'Category'}
        </AppText>
        <QueryState
          isLoading={results.isLoading}
          isError={results.isError}
          error={results.error}
          isEmpty={!results.isLoading && !results.isError && (results.data?.results.length ?? 0) === 0}
          emptyTitle="No sermons yet"
          emptyDescription={name ? `Nothing published under “${name}” yet.` : undefined}
          onRetry={() => results.refetch()}
          loadingLabel="Loading sermons"
        >
          {(results.data?.results ?? []).map((sermon) => (
            <SermonResultRow
              key={sermon.id}
              sermon={sermon}
              onPress={() => router.push({ pathname: '/sermon/[id]', params: { id: sermon.id } })}
            />
          ))}
        </QueryState>
      </ScrollView>
    </>
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
});
