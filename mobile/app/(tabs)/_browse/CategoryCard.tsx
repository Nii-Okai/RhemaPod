import React from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { AppText } from '../../../components';
import { createThemedStyles } from '../../../theme/ThemeContext';
import { radius } from '../../../theme/radius';
import { spacing } from '../../../theme/spacing';
import type { Category } from '../../../lib/query/hooks/useCategories';

export interface CategoryCardProps {
  category: Category;
  onPress: () => void;
  /** Computed by the 2-column grid this renders into (Isaac's ask, session 2026-10-02 —
      Prime Video reference: a "Genres" grid, not a stacked full-width list) — same
      windowWidth-derived sizing `RelatedSermons`' own grid mode uses, since RN's `gap`
      doesn't subtract itself out of a percentage width. */
  width: number;
}

function countLabel(count: number): string {
  return count === 1 ? '1 sermon' : `${count} sermons`;
}

const TILE_MIN_HEIGHT = 96;

/**
 * Design spec 1i/2d. The visible sermon count was dropped (Isaac's ask, session
 * 2026-10-02 — matches the Prime Video "Genres" reference, which shows name only) but
 * still rides along in the accessibility label, same convention `EpisodeRow`'s own
 * dropped number badge uses — VoiceOver users don't lose the information, only the
 * sighted rendering does.
 *
 * Built directly (not the shared `Card`) so it can use `radius.sm` + `surface.nav`
 * rather than `Card`'s own `radius.lg` + `surface.raised` — Isaac's asks, same session:
 * match Home's own card corner radius (`SermonCard`/`SeriesCard`/`HeroCard` all use
 * `radius.sm`), and a background that actually stands out against the screen rather than
 * `surface.raised`'s barely-there step up from `surface.app`. `surface.nav` is the
 * lightest rung of the surface ramp (theme/colors.ts), already used for real surfaces
 * elsewhere (not one of the `chip` tokens the spec explicitly scopes away from general
 * use).
 */
export function CategoryCard({ category, onPress, width }: CategoryCardProps) {
  const styles = useStyles();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${category.name}, ${countLabel(category.sermon_count)}`}
      style={({ pressed }) => [styles.tile, { width }, pressed && styles.pressed]}
    >
      <AppText variant="display.compact" style={styles.title} numberOfLines={2}>
        {category.name}
      </AppText>
    </Pressable>
  );
}

const useStyles = createThemedStyles((colors) => ({
  tile: {
    minHeight: TILE_MIN_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderRadius: radius.sm,
    backgroundColor: colors.surface.nav,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border.card,
  },
  pressed: {
    opacity: 0.7,
  },
  title: {
    textAlign: 'center',
  },
}));
