import React from 'react';
import { ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText, Avatar, IconButton, QueryState } from '../../components';
import { SermonCard } from '../../components/sermon/SermonCard';
import { colors } from '../../theme/colors';
import { spacing } from '../../theme/spacing';
import { useSearchResults } from '../../lib/query/hooks/useSearch';

const GRID_COLUMNS = 2;
const GRID_GAP = spacing.md;
const GRID_PADDING = spacing.lg;
const AVATAR_SIZE = 72;

/** Verbatim fallback copy — matches the admin portal's speaker row (speaker-row.tsx). */
const NO_BIO_FALLBACK = 'No bio yet';

function sermonCountLabel(count: number): string {
  return count === 1 ? '1 sermon' : `${count} sermons`;
}

/**
 * Speaker drill-down — reached by tapping a speaker row on Browse or from a Search
 * result. Custom back-chevron + centered-title header, native Stack header disabled
 * (Isaac's ask, session 2026-10-11: "use preestablish navigation style") — this screen
 * had been left on the Stack's own default native header this whole time
 * (`app/_layout.tsx` carried no `options` for this route at all); now the same
 * bare-chevron pattern `category/[id].tsx`/`series.tsx`'s own phone header established.
 *
 * Reorganized (same ask: "organise it better") around a real info header — an `Avatar`
 * initials chip (no speaker-photo field exists on `SpeakerPublic`, same fallback this
 * app already uses everywhere else a person has no photo on file), name, sermon count,
 * and bio — instead of bare stacked text with nothing to anchor it. Sermons render as a
 * `SermonCard` grid now, not the old text-only `SermonResultRow` (deleted — this was its
 * one remaining call site) — `category/[id].tsx`'s own established grid, so the app's
 * two "drill down from Browse" screens read as siblings instead of two different eras
 * of design. `showMeta={false}` on each card for the same reason `category/[id].tsx`
 * uses it: the meta line would just repeat this speaker's own name on every card.
 *
 * `name`/`bio`/`sermonCount` travel in via nav params — Browse's and Search's own
 * speaker lists already have the full `SpeakerPublic` in hand, so this avoids a second
 * fetch just to re-read three fields. The sermon list itself comes from `/search`
 * filtered on `speaker_id`, same as before.
 */
export default function SpeakerDrillDownScreen() {
  const { id, name, bio, sermonCount } = useLocalSearchParams<{
    id: string;
    name?: string;
    bio?: string;
    sermonCount?: string;
  }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const results = useSearchResults({ speaker_id: id });
  const { width: windowWidth } = useWindowDimensions();
  const cardWidth = (windowWidth - GRID_PADDING * 2 - GRID_GAP * (GRID_COLUMNS - 1)) / GRID_COLUMNS;
  const displayName = name || 'Speaker';
  const count = sermonCount ? Number(sermonCount) : null;

  return (
    <View style={styles.screen}>
      <View style={[styles.header, { paddingTop: Math.max(insets.top, spacing.sm) }]}>
        <IconButton icon="chevron-back" accessibilityLabel="Back" onPress={() => router.back()} />
        <AppText variant="ui.bodyLarge" numberOfLines={1} style={styles.headerTitle}>
          {displayName}
        </AppText>
        <View style={styles.headerSpacer} />
      </View>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.infoRow}>
          <Avatar name={displayName} size={AVATAR_SIZE} />
          <View style={styles.infoText}>
            <AppText variant="display.section" numberOfLines={2}>
              {displayName}
            </AppText>
            {count !== null ? (
              <AppText variant="ui.body" tone="tertiary">
                {sermonCountLabel(count)}
              </AppText>
            ) : null}
          </View>
        </View>
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
          <View style={styles.grid}>
            {(results.data?.results ?? []).map((sermon) => (
              <SermonCard
                key={sermon.id}
                sermon={sermon}
                width={cardWidth}
                showMeta={false}
                onPress={() => router.push({ pathname: '/sermon/[id]', params: { id: sermon.id } })}
              />
            ))}
          </View>
        </QueryState>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.surface.app,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.xs,
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
  },
  headerSpacer: {
    width: 44,
  },
  scroll: {
    flex: 1,
  },
  content: {
    padding: spacing.lg,
    paddingBottom: spacing.xxl * 2,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    marginBottom: spacing.lg,
  },
  infoText: {
    flex: 1,
    gap: spacing.xs,
  },
  bio: {
    marginBottom: spacing.xl,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: GRID_GAP,
  },
});
