import React from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { AppText } from '../../components';
import { colors } from '../../theme/colors';
import { spacing } from '../../theme/spacing';

export interface SearchRowProps {
  label: string;
  /** Falls back to `label` — pass this when the visible text alone loses real
      information a sighted row used to show (a sermon's duration/speaker, a series'
      episode count, a speaker's bio), same convention this whole slice uses elsewhere
      for a dropped-but-still-announced detail. */
  accessibilityLabel?: string;
  onPress: () => void;
}

/**
 * One plain text row with a hairline divider — the single row style Search now uses for
 * everything on the screen (Isaac's ask, session 2026-10-02 — Prime Video reference: a
 * flat list of titles, no thumbnails/avatars/icons), replacing `SuggestionRow`'s own
 * "↗ storm" treatment for live suggestions AND the richer `SermonResultRow`/
 * `SeriesListCard`/`SpeakerListRow` this screen's actual results used to render. Those
 * three keep their richer look everywhere else they're still used (category/speaker
 * drill-down, the all-series page, Browse) — only Search itself went flat.
 */
export function SearchRow({ label, accessibilityLabel, onPress }: SearchRowProps) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
    >
      <AppText variant="ui.bodyLarge" numberOfLines={1}>
        {label}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border.default,
  },
  rowPressed: {
    opacity: 0.7,
  },
});
