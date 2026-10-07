import React from 'react';
import { ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { AppText } from '../Text';
import { ImageOnlyCard } from './ImageOnlyCard';
import { spacing } from '../../theme/spacing';
import { useSearchResults } from '../../lib/query/hooks/useSearch';

export interface RelatedSermonsProps {
  categoryId: string | null;
  /** Series detail: the series itself, so every one of its own episodes is excluded.
      Sermon detail: the sermon's own `series_id` (if it has one), for the same reason. */
  excludeSeriesId?: string;
  /** Sermon detail only: excludes the sermon itself from its own "related" rail. */
  excludeSermonId?: string;
  onPressSermon: (id: string) => void;
  /** Sermon detail's own Related section (Isaac's ask, session 2026-10-01): a 2-column
      grid instead of series detail's horizontal rail. Defaults to the original
      horizontal rail — series detail passes nothing and keeps that layout. */
  grid?: boolean;
}

const GRID_COLUMNS = 2;
// Square (Isaac's follow-up ask, same session: "about half the size" of the original
// 9:16 portrait card — 1:1 is close to that halving at this column width, and reads as
// a deliberate square rather than an arbitrary in-between ratio).
const GRID_ASPECT_RATIO = 1;
// Isaac's follow-up asks, same session: more breathing room than the original
// near-touching gap (Netflix "More Like This" reference screenshot) — bumped once
// already (xs to sm), then again here (sm to md).
const GRID_GAP = spacing.md;
const GRID_PADDING = spacing.md;

/**
 * A "Related" rail of other sermons/episodes sharing a category (Isaac's ask, session
 * 2026-10-01 — series detail's "Related" tab originally showed whole other *series*;
 * corrected to standalone sermons and episodes instead, since a series card just routes
 * back into another title page rather than surfacing a specific thing to watch next).
 * Promoted here, same session, when sermon detail became its second consumer.
 *
 * Reuses `/search`'s filtered-browse mode (`useSearchResults({ category_id })` — the
 * same hook `app/category/[id].tsx` already drives its own list from) rather than a
 * dedicated "related" endpoint, since none exists. `/search` has no server-side
 * exclusion filter, so both exclusions happen client-side — otherwise "Related" would
 * just echo the current series' own episode list, or a sermon's own card, back at it.
 *
 * An uncategorised item, or a category with nothing else in it, shows an honest empty
 * state rather than falling back to "everything else" — a list padded with sermons that
 * aren't actually related isn't more useful than admitting there's nothing to show.
 *
 * Renders `ImageOnlyCard` (Isaac's ask, session 2026-10-01: no title, no duration under
 * each related item) — the same no-text card Home's own Recommended/Trending shelves
 * use, not `SermonCard`. The sermon's title still reaches screen readers via the card's
 * own `accessibilityLabel`; only the sighted rendering loses the text, same reasoning
 * `ImageOnlyCard`'s own doc comment gives for those two shelves.
 *
 * `grid`'s card width is computed from `useWindowDimensions()` rather than a percentage
 * style — RN's `gap` doesn't subtract itself out of percentage widths, so even
 * percentage-wide columns plus real gaps would overflow the row.
 */
export function RelatedSermons({
  categoryId,
  excludeSeriesId,
  excludeSermonId,
  onPressSermon,
  grid = false,
}: RelatedSermonsProps) {
  const { width: windowWidth } = useWindowDimensions();
  const results = useSearchResults({ category_id: categoryId ?? undefined }, { enabled: categoryId !== null });

  if (categoryId === null) {
    return (
      <AppText variant="ui.body" tone="secondary" style={styles.message}>
        No related sermons yet.
      </AppText>
    );
  }

  if (results.isLoading) {
    return (
      <AppText variant="ui.body" tone="secondary" style={styles.message}>
        Loading related sermons…
      </AppText>
    );
  }

  if (results.isError) {
    return (
      <AppText variant="ui.body" tone="secondary" style={styles.message}>
        Something went wrong loading related sermons.
      </AppText>
    );
  }

  const filtered = (results.data?.results ?? []).filter(
    (sermon) =>
      (excludeSeriesId ? sermon.series_id !== excludeSeriesId : true) &&
      (excludeSermonId ? sermon.id !== excludeSermonId : true),
  );
  // One episode per series (Isaac's ask, session 2026-10-01) — otherwise a series with
  // several episodes sharing this category could fill most of "Related" by itself.
  // Standalone sermons (`series_id === null`) are never deduped against each other.
  const seenSeriesIds = new Set<string>();
  const related = filtered.filter((sermon) => {
    if (!sermon.series_id) return true;
    if (seenSeriesIds.has(sermon.series_id)) return false;
    seenSeriesIds.add(sermon.series_id);
    return true;
  });

  if (related.length === 0) {
    return (
      <AppText variant="ui.body" tone="secondary" style={styles.message}>
        No related sermons yet.
      </AppText>
    );
  }

  if (grid) {
    const cardWidth = (windowWidth - GRID_PADDING * 2 - GRID_GAP * (GRID_COLUMNS - 1)) / GRID_COLUMNS;
    return (
      <View style={styles.grid}>
        {related.map((sermon) => (
          <ImageOnlyCard
            key={sermon.id}
            sermon={sermon}
            onPress={() => onPressSermon(sermon.id)}
            width={cardWidth}
            aspectRatio={GRID_ASPECT_RATIO}
          />
        ))}
      </View>
    );
  }

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
      {related.map((sermon) => (
        <ImageOnlyCard key={sermon.id} sermon={sermon} onPress={() => onPressSermon(sermon.id)} />
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: {
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: GRID_GAP,
    paddingHorizontal: GRID_PADDING,
  },
  message: {
    paddingHorizontal: spacing.lg,
  },
});
