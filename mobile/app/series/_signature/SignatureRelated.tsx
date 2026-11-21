import React from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import { AppText } from '../../../components';
import { spacing } from '../../../theme/spacing';
import { useSearchResults } from '../../../lib/query/hooks/useSearch';
import { ArtTile } from '../../(tabs)/_home/signature/ArtTile';
import { pickRelated } from './episodeProgress';
import { gridColumnsForWidth } from '../../../components/navigation/responsive';

const COLUMNS = 3;
const GAP = spacing.sm;
const PADDING = spacing.lg;
// Portrait tiles, as in the mockup; the landscape art is centre-cropped like Home's Trending.
const ASPECT_RATIO = 3 / 4;

export interface SignatureRelatedProps {
  seriesId: string;
  categoryId: string | null;
  onPressSermon: (id: string) => void;
  /** Width the grid has; defaults to the window's (the right pane is narrower on a tablet). */
  width?: number;
}

/** The Related tab: the classic tab's list, drawn as a three-column grid of art tiles. */
export function SignatureRelated({ seriesId, categoryId, onPressSermon, width }: SignatureRelatedProps) {
  const { width: windowWidth } = useWindowDimensions();
  const gridWidth = width ?? windowWidth;
  // 3 across on a phone, 4–5 on a tablet.
  const columns = gridColumnsForWidth(gridWidth, COLUMNS, windowWidth);
  const results = useSearchResults({ category_id: categoryId ?? undefined }, { enabled: categoryId !== null });

  const message = (text: string) => (
    <AppText variant="ui.body" tone="secondary" style={styles.message}>
      {text}
    </AppText>
  );

  if (categoryId === null) return message('No related sermons yet.');
  if (results.isLoading) return message('Loading related sermons…');
  if (results.isError) return message('Something went wrong loading related sermons.');

  const related = pickRelated(results.data?.results ?? [], seriesId);
  if (related.length === 0) return message('No related sermons yet.');

  const tileWidth = (gridWidth - PADDING * 2 - GAP * (columns - 1)) / columns;
  return (
    <View style={styles.grid}>
      {related.map((sermon) => (
        <ArtTile
          key={sermon.id}
          thumbnailUrl={sermon.thumbnail_url}
          onPress={() => onPressSermon(sermon.id)}
          accessibilityLabel={sermon.title}
          width={tileWidth}
          aspectRatio={ASPECT_RATIO}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: GAP,
    paddingHorizontal: PADDING,
    paddingTop: spacing.lg,
  },
  message: {
    paddingHorizontal: PADDING,
    paddingTop: spacing.lg,
  },
});
