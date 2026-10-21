import React from 'react';
import { Image, View } from 'react-native';
import { PressableScale } from '../PressableScale';
import { createThemedStyles } from '../../theme/ThemeContext';
import { radius } from '../../theme/radius';
import type { SermonListItem } from '../../lib/query/hooks/useSermons';

export interface ImageOnlyCardProps {
  sermon: SermonListItem;
  onPress: () => void;
  /** Defaults match the original "Recommended for you" sizing. Trending overrides both
   * to a narrower, taller card — see `home.tsx`'s call site. `'100%'` stretches the card
   * to its container's width instead of a fixed rail size — `RelatedSermons`' vertical
   * layout uses this. */
  width?: number | '100%';
  aspectRatio?: number;
}

const DEFAULT_CARD_WIDTH = 160;
const DEFAULT_ASPECT_RATIO = 16 / 9;

/**
 * Image-only sermon card — no title/meta text under the art at all, unlike
 * `SermonCard`. Originally Home's "Recommended for you"/"Trending" shelves; the
 * series-detail "Related" rail became its second concrete consumer (Isaac's ask,
 * session 2026-10-01: drop the title and duration there too), which is why this moved
 * out of Home's own `_home/` folder into `components/sermon/` alongside `SermonCard`.
 * The sermon's title still becomes the control's `accessibilityLabel` even though
 * nothing is drawn on screen — VoiceOver/TalkBack users still need to know what they're
 * about to open; "no titles" is a sighted-rendering choice, not a reason to ship an
 * unlabeled button.
 *
 * `width`/`aspectRatio` are per-shelf, not per-sermon. `resizeMode="cover"` fills the box
 * edge-to-edge with no letterboxing (Isaac's call: source thumbnails are landscape,
 * Trending/Recommended's box is portrait 3:4, and a full card beats empty bars — cropping
 * some of the landscape edges is the accepted trade-off). RN centers the crop on both axes
 * by default, so the visible slice is always the middle of the image, not an arbitrary edge.
 */
export function ImageOnlyCard({
  sermon,
  onPress,
  width = DEFAULT_CARD_WIDTH,
  aspectRatio = DEFAULT_ASPECT_RATIO,
}: ImageOnlyCardProps) {
  const styles = useStyles();
  return (
    <PressableScale
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={sermon.title}
      style={[styles.card, { width }]}
    >
      {sermon.thumbnail_url ? (
        <Image source={{ uri: sermon.thumbnail_url }} style={[styles.art, { aspectRatio }]} resizeMode="cover" />
      ) : (
        <View style={[styles.artFallback, { aspectRatio }]} />
      )}
    </PressableScale>
  );
}

const useStyles = createThemedStyles((colors) => ({
  card: {
    borderRadius: radius.sm,
    overflow: 'hidden',
    backgroundColor: colors.surface.raised,
  },
  art: {
    width: '100%',
    backgroundColor: colors.surface.sunken,
  },
  artFallback: {
    width: '100%',
    backgroundColor: colors.surface.sunken,
  },
}));
