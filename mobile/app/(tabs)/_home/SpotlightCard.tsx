import React from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { AppText, PressableScale } from '../../../components';
import { darkColors as onArt } from '../../../theme/colors';
import { createThemedStyles } from '../../../theme/ThemeContext';
import { radius } from '../../../theme/radius';
import { spacing } from '../../../theme/spacing';
import type { SermonListItem } from '../../../lib/query/hooks/useSermons';

export interface SpotlightCardProps {
  sermon: SermonListItem;
  onPress: () => void;
}

/**
 * Full-bleed single-item feature between two of Home's shelves (Isaac's ask, session
 * 2026-09-30: break the "every section is a horizontal row" rhythm — YouTube/Spotify's
 * pattern of interleaving one featured card between shelves). Always the current
 * Prophet's Catalog top pick, so it changes with the same daily shuffle that shelf
 * already uses (`content_service._daily_shuffle`) rather than needing its own
 * selection logic. Deliberately also still appears in the regular Prophet's Catalog
 * shelf below it — double-featuring the same pick is the established pattern (Apple
 * TV+, Netflix), not a bug.
 *
 * No title/meta text at all (Isaac's ask, session 2026-09-30) — same "no titles"
 * treatment `ImageOnlyCard` uses for Recommended/Trending. The accessibility label
 * still always carries the title (`ImageOnlyCard`'s own precedent: "no titles" is a
 * sighted-rendering choice, not a reason to ship an unlabeled button).
 */
export function SpotlightCard({ sermon, onPress }: SpotlightCardProps) {
  const styles = useStyles();
  return (
    <PressableScale
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${sermon.title}, Prophet's Pick`}
      style={styles.card}
    >
      <View style={styles.artWrap}>
        {sermon.thumbnail_url ? (
          <Image source={{ uri: sermon.thumbnail_url }} style={styles.art} resizeMode="cover" />
        ) : (
          <View style={styles.artFallback} />
        )}
        <View style={styles.chip} pointerEvents="none">
          <AppText variant="ui.label" style={styles.chipText}>
            Prophet&rsquo;s Pick
          </AppText>
        </View>
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
    borderColor: colors.accent.gold,
  },
  artWrap: {
    aspectRatio: 16 / 9,
  },
  art: {
    ...StyleSheet.absoluteFillObject,
  },
  artFallback: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.surface.sunken,
  },
  chip: {
    position: 'absolute',
    top: spacing.md,
    left: spacing.md,
    backgroundColor: colors.overlay.chipFill,
    borderWidth: StyleSheet.hairlineWidth,
    // On the art: the dark palette's gold in both themes (the light palette's deeper gold
    // is tuned for light chrome and would sink into the dark chip).
    borderColor: onArt.accent.gold,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  chipText: {
    color: onArt.accent.goldText,
  },
}));
