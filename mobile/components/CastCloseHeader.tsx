import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { IconButton } from './IconButton';
import { colors } from '../theme/colors';
import { radius } from '../theme/radius';
import { spacing } from '../theme/spacing';

export interface CastCloseHeaderProps {
  onClose: () => void;
  /** Drill-down entry only (Isaac's ask, session 2026-10-01 — tapping a Related item
      pushes a *new* detail screen on top of the current one, standard right-to-left,
      rather than presenting fresh with the vertical-dismiss gesture): a back chevron at
      top-left, alongside Cast/Close at top-right, matching Isaac's own reference
      screenshot. Omitted (the default) for every other way of reaching this screen —
      no chevron renders at all, same as before this existed. */
  onBack?: () => void;
}

/**
 * Cast+Close chrome for a title-page-style detail screen (Isaac's ask, session
 * 2026-09-30, series detail; promoted to shared, session 2026-10-01, sermon detail
 * became its second consumer) — Prime Video/Netflix's own title-page chrome, replacing
 * the plain back-chevron `DetailHeader` on screens built with a full-bleed hero banner.
 *
 * The cast icon is rendered disabled — there is no Chromecast/AirPlay integration
 * anywhere in this app (mobile or backend). Shipping it as a dead `onPress` that
 * silently does nothing would look like a bug; shipping it disabled is honest about
 * what's actually there today without hiding the chrome Isaac asked for.
 *
 * Absolutely positioned over the hero (same reasoning `DetailHeader`'s iOS variant
 * already uses) — takes no layout space, so the hero renders at its full size
 * underneath it.
 *
 * Each icon sits on its own translucent circular chip (Isaac's ask, session 2026-10-01)
 * — `colors.overlay.chipFill`/`chipBorder`, the same translucent-chip-over-art pattern
 * `HeroCard`'s play button and `EpisodeRow`'s own overlays already use, not a new color.
 * Scoped to this header only (wraps each `IconButton` here, rather than adding a
 * background to `IconButton` itself) — that component is shared with the player's
 * transport controls and others that shouldn't pick this up unasked.
 */
export function CastCloseHeader({ onClose, onBack }: CastCloseHeaderProps) {
  const insets = useSafeAreaInsets();

  return (
    <>
      {onBack ? (
        <View style={[styles.leftRow, { top: insets.top + spacing.sm }]} pointerEvents="box-none">
          <View style={styles.iconChip}>
            <IconButton icon="chevron-back" accessibilityLabel="Back" onPress={onBack} />
          </View>
        </View>
      ) : null}
      <View style={[styles.row, { top: insets.top + spacing.sm }]} pointerEvents="box-none">
        <View style={styles.iconChip}>
          <IconButton icon="tv-outline" accessibilityLabel="Cast" disabled onPress={() => {}} />
        </View>
        <View style={styles.iconChip}>
          <IconButton icon="close" accessibilityLabel="Close" onPress={onClose} />
        </View>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  row: {
    position: 'absolute',
    right: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    zIndex: 10,
  },
  leftRow: {
    position: 'absolute',
    left: spacing.sm,
    zIndex: 10,
  },
  iconChip: {
    borderRadius: radius.pill,
    backgroundColor: colors.overlay.chipFill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.overlay.chipBorder,
    overflow: 'hidden',
  },
});
