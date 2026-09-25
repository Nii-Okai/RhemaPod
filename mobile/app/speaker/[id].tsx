import React from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { AppText, QueryState } from '../../components';
import { SermonResultRow } from '../../components/sermon/SermonResultRow';
import { colors } from '../../theme/colors';
import { spacing } from '../../theme/spacing';
import { useSearchResults } from '../../lib/query/hooks/useSearch';

/** Verbatim fallback copy — matches the admin portal's speaker row (speaker-row.tsx). */
const NO_BIO_FALLBACK = 'No bio yet';

/**
 * Speaker drill-down list — reached by tapping a speaker row on Browse.
 * `name`/`bio` travel in via nav params (the Browse list already has the
 * full `SpeakerPublic`, so this avoids a second fetch just to re-read the
 * same two fields); the sermon list itself comes from `/search` filtered on
 * `speaker_id`, same pattern as the category drill-down.
 */
export default function SpeakerDrillDownScreen() {
  const { id, name, bio } = useLocalSearchParams<{ id: string; name?: string; bio?: string }>();
  const router = useRouter();
  const results = useSearchResults({ speaker_id: id });

  return (
    <>
      <Stack.Screen options={{ title: name || 'Speaker' }} />
      <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
        <AppText variant="display.section" style={styles.heading}>
          {name || 'Speaker'}
        </AppText>
        <AppText variant="ui.body" tone={bio ? 'secondary' : 'tertiary'} style={styles.bio}>
          {bio || NO_BIO_FALLBACK}
        </AppText>
        <QueryState
          isLoading={results.isLoading}
          isError={results.isError}
          error={results.error}
          isEmpty={!results.isLoading && !results.isError && (results.data?.results.length ?? 0) === 0}
          emptyTitle="No sermons yet"
          emptyDescription={name ? `Nothing published by ${name} yet.` : undefined}
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
    marginBottom: spacing.sm,
  },
  bio: {
    marginBottom: spacing.xl,
  },
});
