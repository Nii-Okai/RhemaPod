import React from 'react';
import { Image, View } from 'react-native';
import { AppText } from '../Text';
import { FadeTitle } from '../FadeTitle';
import { PressableScale } from '../PressableScale';
import { createThemedStyles } from '../../theme/ThemeContext';
import { radius } from '../../theme/radius';
import { spacing } from '../../theme/spacing';
import { formatDuration } from '../../lib/format/duration';
import type { SermonListItem } from '../../lib/query/hooks/useSermons';

export interface SermonCardProps {
  sermon: SermonListItem;
  onPress: () => void;
  /** Defaults match Series/Continue Watching's own sizing. New Releases overrides this
      to a wider card — see `home.tsx`'s call site. */
  width?: number;
  /** Visible meta line (speaker, else duration) under the title. Defaults to shown;
      New Releases turns it off for a leaner card — the accessibility label still
      always carries it regardless, same as `ImageOnlyCard`'s own title-in-label
      convention for a sighted-rendering-only omission. */
  showMeta?: boolean;
  /** A thin gold ring around the card — Prophet's Catalog only (Isaac's ask, session
      2026-09-30: give the shelf's name a visual meaning, not just a text label). The
      gold accent is deliberately rare elsewhere in this app (`theme/colors.ts`'s own
      "do not collapse these into a single gold value" note), so this stays an opt-in
      prop rather than a `SermonCard` default. */
  highlighted?: boolean;
}

const DEFAULT_CARD_WIDTH = 200;

/** Speaker name when there is one; the sermon's own duration otherwise — never both,
    matching `SeriesCard`'s single mono meta line. */
function metaLabel(sermon: SermonListItem): string {
  return sermon.speaker_name ?? formatDuration(sermon.duration_seconds);
}

/**
 * A plain `SermonListItem` rail card — Home's "New Releases"/"Prophet's Catalog" shelves
 * (Isaac's ask, session 2026-09-30), and the series-detail "Related" rail's second
 * concrete consumer (session 2026-10-01), which is why this moved out of Home's own
 * `_home/` folder into `components/sermon/` alongside `SermonResultRow`. Same visual
 * language as `ContinueWatchingCard`/`SeriesCard` (16:9 `resizeMode="cover"` art,
 * bold+fade title, mono meta line below) rather than the titleless `ImageOnlyCard` used
 * by Recommended/Trending — those two are algorithmic discovery shelves Isaac explicitly
 * wanted image-only; these are editorial/curated lists where the title carries real
 * information (which sermon this is, not just "something new").
 */
export function SermonCard({
  sermon,
  onPress,
  width = DEFAULT_CARD_WIDTH,
  showMeta = true,
  highlighted = false,
}: SermonCardProps) {
  const styles = useStyles();
  const meta = metaLabel(sermon);
  const titleWidth = width - spacing.md * 2;

  return (
    <PressableScale
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${sermon.title}, ${meta}`}
      style={[styles.card, { width }, highlighted && styles.cardHighlighted]}
    >
      {sermon.thumbnail_url ? (
        <Image source={{ uri: sermon.thumbnail_url }} style={styles.art} resizeMode="cover" />
      ) : (
        <View style={styles.artFallback} />
      )}
      <View style={styles.body}>
        <FadeTitle width={titleWidth}>{sermon.title}</FadeTitle>
        {showMeta ? (
          <AppText variant="mono.meta" tone="tertiary">
            {meta}
          </AppText>
        ) : null}
      </View>
    </PressableScale>
  );
}

const useStyles = createThemedStyles((colors) => ({
  card: {
    borderRadius: radius.sm,
    overflow: 'hidden',
    backgroundColor: colors.surface.raised,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  cardHighlighted: {
    borderColor: colors.accent.gold,
  },
  art: {
    width: '100%',
    aspectRatio: 16 / 9,
  },
  artFallback: {
    width: '100%',
    aspectRatio: 16 / 9,
    backgroundColor: colors.surface.sunken,
  },
  body: {
    padding: spacing.md,
    gap: spacing.xs,
  },
}));
