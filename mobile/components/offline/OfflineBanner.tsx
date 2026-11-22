import React from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { AppText } from '../Text';
import { PlatformIcon } from '../PlatformIcon';
import { createThemedStyles, useTheme } from '../../theme/ThemeContext';
import { radius } from '../../theme/radius';
import { spacing } from '../../theme/spacing';
import { useIsOnline } from '../../lib/hooks/useIsOnline';
import { OfflineChip } from './OfflineCard';
import { useOpenOfflineHelp } from './useOpenOfflineHelp';

/**
 * The quiet "You're offline" strip at the top of a tab screen (offline mockups, Nii
 * 2026-11-22). Renders nothing while online; tapping it opens the offline page.
 */
export function OfflineBanner({ style }: { style?: StyleProp<ViewStyle> }) {
  const online = useIsOnline();
  const styles = useStyles();
  const { colors } = useTheme();
  const openHelp = useOpenOfflineHelp();
  if (online) return null;
  return (
    <Pressable
      onPress={openHelp}
      accessibilityRole="button"
      accessibilityLabel="You're offline. Downloads still play. Opens help to reconnect."
      style={({ pressed }) => [styles.banner, pressed && styles.pressed, style]}
    >
      <OfflineChip size={34} />
      <View style={styles.text}>
        <AppText variant="ui.bodyBold">You&rsquo;re offline</AppText>
        <AppText variant="ui.badge" tone="secondary">
          Downloads still play. Tap for help reconnecting.
        </AppText>
      </View>
      <PlatformIcon name="chevron-forward" size={18} color={colors.text.tertiary} />
    </Pressable>
  );
}

const useStyles = createThemedStyles((colors) => ({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md - 1,
    paddingHorizontal: spacing.md + 2,
    borderRadius: radius.xl,
    backgroundColor: colors.status.wheat.bg,
    borderColor: colors.status.wheat.border,
    borderWidth: StyleSheet.hairlineWidth,
  },
  pressed: {
    opacity: 0.85,
  },
  text: {
    flex: 1,
    gap: 2,
  },
}));
