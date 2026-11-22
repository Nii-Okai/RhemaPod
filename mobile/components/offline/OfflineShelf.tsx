import React from 'react';
import { Pressable, View } from 'react-native';
import { AppText } from '../Text';
import { createThemedStyles } from '../../theme/ThemeContext';
import { radius } from '../../theme/radius';
import { spacing } from '../../theme/spacing';
import { useTabContentWidth } from '../navigation/responsive';
import { OfflineChip } from './OfflineCard';
import { useOpenOfflineHelp } from './useOpenOfflineHelp';

export interface OfflineShelfProps {
  /** The shelf's title, for the spoken label ("Keep listening"). */
  title: string;
  /** The real card's width and art shape, so the ghosts sit where the cards will. */
  cardWidth: number;
  aspectRatio: number;
  /** The line under the first ghost. Defaults to "Waiting for connection". */
  hint?: string;
}

/**
 * A horizontal shelf's offline state: ghost cards in the shelf's own card shape, the first
 * carrying the cloud-off chip and a short line. There are as many ghosts as fill the
 * screen's width, so it reads as a full row on a phone and on a tablet beside the rail.
 * The whole row is one button that opens the offline page.
 */
export function OfflineShelf({ title, cardWidth, aspectRatio, hint = 'Waiting for connection' }: OfflineShelfProps) {
  const styles = useStyles();
  const openHelp = useOpenOfflineHelp();
  const contentWidth = useTabContentWidth();
  const count = Math.max(2, Math.ceil(contentWidth / (cardWidth + spacing.md)));
  const artHeight = cardWidth / aspectRatio;
  return (
    <Pressable
      onPress={openHelp}
      accessibilityRole="button"
      accessibilityLabel={`${title}: you’re offline. ${hint}.`}
      accessibilityHint="Opens help to reconnect"
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      {Array.from({ length: count }, (_, i) => (
        <View key={i} style={{ width: cardWidth }}>
          <View style={[styles.art, { height: artHeight }]}>{i === 0 ? <OfflineChip /> : null}</View>
          {i === 0 ? (
            <AppText variant="ui.badge" tone="tertiary" numberOfLines={2} style={styles.hint}>
              {hint} ·{' '}
              <AppText variant="ui.badge" tone="gold">
                Check settings
              </AppText>
            </AppText>
          ) : (
            <>
              <View style={[styles.line, styles.lineLong]} />
              <View style={[styles.line, styles.lineShort]} />
            </>
          )}
        </View>
      ))}
    </Pressable>
  );
}

const useStyles = createThemedStyles((colors) => ({
  row: {
    flexDirection: 'row',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    overflow: 'hidden',
  },
  pressed: {
    opacity: 0.8,
  },
  art: {
    borderRadius: radius.lg,
    backgroundColor: colors.surface.sunken,
    borderColor: colors.border.card,
    borderWidth: 1,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
  },
  hint: {
    marginTop: spacing.sm,
  },
  line: {
    height: 9,
    borderRadius: radius.sm,
    backgroundColor: colors.track.default,
  },
  lineLong: {
    width: '80%',
    marginTop: spacing.sm + 2,
  },
  lineShort: {
    width: '50%',
    marginTop: spacing.sm - 1,
  },
}));
