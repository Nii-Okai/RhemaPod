import React from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { AppText } from '../Text';
import { PlatformIcon } from '../PlatformIcon';
import { createThemedStyles, useTheme } from '../../theme/ThemeContext';
import { radius } from '../../theme/radius';
import { spacing } from '../../theme/spacing';
import { useOpenOfflineHelp } from './useOpenOfflineHelp';

export interface OfflineCardProps {
  /** Defaults to "You're offline". */
  title?: string;
  /** Defaults to "This will load when you're back online". */
  message?: string;
  /** Match the shape of what it stands in for (16/9 for a sermon card, for example). */
  aspectRatio?: number;
  /** A smaller, single-row version for tight spots (sheets, inline sections). */
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
}

/**
 * The calm stand-in for content that couldn't load because the phone is offline (offline
 * mockups, Nii 2026-11-22): a dashed ghost card with a gold cloud-off chip and a line of
 * copy, in place of the red "Could not reach the server" box. Tapping it opens the offline
 * page, which links to the phone's settings.
 */
export function OfflineCard({
  title = 'You’re offline',
  message = 'This will load when you’re back online',
  aspectRatio,
  compact = false,
  style,
}: OfflineCardProps) {
  const styles = useStyles();
  const openHelp = useOpenOfflineHelp();
  return (
    <Pressable
      onPress={openHelp}
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${message}.`}
      accessibilityHint="Opens help to reconnect"
      style={({ pressed }) => [
        styles.card,
        compact ? styles.compact : styles.block,
        aspectRatio ? { aspectRatio } : null,
        pressed && styles.pressed,
        style,
      ]}
    >
      <OfflineChip />
      <View style={compact ? styles.compactText : styles.blockText}>
        <AppText variant={compact ? 'ui.label' : 'display.compact'} style={compact ? null : styles.center}>
          {title}
        </AppText>
        <AppText variant="ui.badge" tone="tertiary" style={compact ? null : styles.center}>
          {message} ·{' '}
          <AppText variant="ui.badge" tone="gold">
            Check settings
          </AppText>
        </AppText>
      </View>
    </Pressable>
  );
}

/** The round gold cloud-off chip every offline placeholder leads with. */
export function OfflineChip({ size = 38 }: { size?: number }) {
  const styles = useStyles();
  const { colors } = useTheme();
  return (
    <View style={[styles.chip, { width: size, height: size, borderRadius: size / 2 }]}>
      <PlatformIcon name="cloud-offline-outline" size={Math.round(size * 0.5)} color={colors.accent.goldText} />
    </View>
  );
}

const useStyles = createThemedStyles((colors) => ({
  card: {
    backgroundColor: colors.surface.sunken,
    borderColor: colors.border.card,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderRadius: radius.xl,
  },
  block: {
    minHeight: 140,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    padding: spacing.lg,
  },
  compact: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
  },
  blockText: {
    alignItems: 'center',
    gap: spacing.xs,
  },
  compactText: {
    flex: 1,
    gap: 2,
  },
  center: {
    textAlign: 'center',
  },
  pressed: {
    opacity: 0.8,
  },
  chip: {
    backgroundColor: colors.chip.square,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border.card,
  },
}));
