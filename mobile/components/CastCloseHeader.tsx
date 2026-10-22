import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { IconButton } from './IconButton';
import { darkColors as onArt } from '../theme/colors';
import { createThemedStyles } from '../theme/ThemeContext';
import { radius } from '../theme/radius';
import { spacing } from '../theme/spacing';
import { googleCast } from '../lib/cast/googleCast';

export interface CastCloseHeaderProps {
  onClose: () => void;
  /** Drill-down entry only (Isaac's ask, session 2026-10-01 — tapping a Related item
      pushes a *new* detail screen on top of the current one, standard right-to-left,
      rather than presenting fresh with the vertical-dismiss gesture): a back chevron at
      top-left, alongside Cast/Close at top-right, matching Isaac's own reference
      screenshot. Omitted (the default) for every other way of reaching this screen —
      no chevron renders at all, same as before this existed. */
  onBack?: () => void;
  /** The screen casts (series detail, with `useCastPlayback`): render the real Google
      Cast button in place of the disabled placeholder. Builds without the Cast SDK
      linked (`googleCast` is null) keep the placeholder either way. */
  castEnabled?: boolean;
}

/**
 * Cast+Close chrome for a title-page-style detail screen (Isaac's ask, session
 * 2026-09-30, series detail; promoted to shared, session 2026-10-01, sermon detail
 * became its second consumer) — Prime Video/Netflix's own title-page chrome, replacing
 * the plain back-chevron `DetailHeader` on screens built with a full-bleed hero banner.
 *
 * The cast icon is the real Google Cast button where the screen casts (`castEnabled`,
 * series detail — Nii's ask, 2026-10-22) and the build has the Cast SDK; everywhere else
 * it stays rendered disabled — a dead `onPress` that silently does nothing would look
 * like a bug; shipping it disabled is honest about what's actually there.
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
export function CastCloseHeader({ onClose, onBack, castEnabled = false }: CastCloseHeaderProps) {
  const styles = useStyles();
  const insets = useSafeAreaInsets();

  return (
    <>
      {onBack ? (
        <View style={[styles.leftRow, { top: insets.top + spacing.sm }]} pointerEvents="box-none">
          <View style={styles.iconChip}>
            <IconButton icon="chevron-back" accessibilityLabel="Back" onPress={onBack} color={onArt.text.primary} />
          </View>
        </View>
      ) : null}
      <View style={[styles.row, { top: insets.top + spacing.sm }]} pointerEvents="box-none">
        <View style={styles.iconChip}>
          {castEnabled && googleCast ? (
            // The SDK's own button: the official cast icon, its connecting/connected
            // states, and the device picker on tap.
            <googleCast.CastButton style={styles.castButton} tintColor={onArt.text.primary} accessibilityLabel="Cast" />
          ) : (
            <IconButton icon="tv-outline" accessibilityLabel="Cast" disabled onPress={() => {}} color={onArt.text.primary} />
          )}
        </View>
        <View style={styles.iconChip}>
          <IconButton icon="close" accessibilityLabel="Close" onPress={onClose} color={onArt.text.primary} />
        </View>
      </View>
    </>
  );
}

const useStyles = createThemedStyles((colors) => ({
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
  // Same footprint as an `IconButton` (24pt glyph + `spacing.sm` padding each side).
  castButton: {
    width: 24 + spacing.sm * 2,
    height: 24 + spacing.sm * 2,
  },
  iconChip: {
    borderRadius: radius.pill,
    backgroundColor: colors.overlay.chipFill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.overlay.chipBorder,
    overflow: 'hidden',
  },
}));
