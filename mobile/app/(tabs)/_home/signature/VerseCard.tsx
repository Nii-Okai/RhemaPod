import React from 'react';
import { StyleSheet, View } from 'react-native';
import { AppText } from '../../../../components';
import { createThemedStyles, useTheme } from '../../../../theme/ThemeContext';
import { spacing } from '../../../../theme/spacing';
import { useVerseOfTheDay } from '../../../../lib/query/hooks/useVerseOfTheDay';
import { Flame } from './Flame';
import { LEAF_SM } from './leaf';

/**
 * Signature Home's opening panel: the verse of the day on its own (it's a daily pick, not
 * tied to any sermon). Same quiet failure as the classic `VerseStrip` — nothing renders
 * while loading, on an error, or when the server has no verse.
 */
export function VerseCard() {
  const styles = useStyles();
  const { colors } = useTheme();
  const { data: verse } = useVerseOfTheDay();

  if (!verse) return null;

  // Verses come in as entered in the admin portal, sometimes with hard line breaks and
  // stray spaces mid-sentence (Nii's phone test, 2026-10-21). One flowing line reads right.
  const text = verse.text.replace(/\s+/g, ' ').trim();

  return (
    <View
      style={styles.card}
      accessible
      accessibilityLabel={`Verse of the day. ${text}. ${verse.reference}, ${verse.translation}`}
    >
      <View style={styles.flame}>
        <Flame width={12} fill={colors.accent.gold} />
      </View>
      <View style={styles.body}>
        <AppText variant="mono.meta" tone="gold">
          VERSE OF THE DAY
        </AppText>
        <AppText variant="display.compact">“{text}”</AppText>
        <AppText variant="mono.meta" tone="tertiary">
          {`${verse.reference} · ${verse.translation}`.toUpperCase()}
        </AppText>
      </View>
    </View>
  );
}

const useStyles = createThemedStyles((colors) => ({
  card: {
    ...LEAF_SM,
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.lg,
    backgroundColor: colors.surface.raised,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border.default,
  },
  flame: {
    paddingTop: spacing.xs,
  },
  body: {
    flex: 1,
    gap: spacing.sm,
  },
}));
