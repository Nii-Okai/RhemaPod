import React from 'react';
import { Pressable, View } from 'react-native';
import { createThemedStyles, useTheme } from '../../theme/ThemeContext';
import { radius } from '../../theme/radius';
import { spacing } from '../../theme/spacing';
import { AppText } from '../Text';
import { NavIcon } from './NavIcon';
import type { NavRoute } from './routes';

export interface IconNavItemProps {
  route: NavRoute;
  active: boolean;
  onPress: () => void;
  /** `bottom`: Android nav bar (row, flexed item). `rail`: tablet rail (fixed-width column). */
  orientation: 'bottom' | 'rail';
}

/**
 * Icon + always-visible label item with an M3-style pill active indicator (design spec
 * §2's "pill active-indicator"). Shared by the Android bottom bar and the tablet rail —
 * `PhoneTabBarIOS` shows icons too now (Isaac's ask, session 2026-10-11), but with its
 * own plainer, non-pill iOS-native treatment rather than reusing this component — the
 * M3 pill indicator is a distinctly Material pattern, not one iOS's own tab bar uses.
 */
export function IconNavItem({ route, active, onPress, orientation }: IconNavItemProps) {
  const { colors } = useTheme();
  const styles = useStyles();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={route.label}
      onPress={onPress}
      style={({ pressed }) => [
        orientation === 'bottom' ? styles.bottomItem : styles.railItem,
        pressed && styles.itemPressed,
      ]}
    >
      <View style={[styles.pill, active && styles.pillActive]}>
        <NavIcon route={route} active={active} size={22} color={active ? colors.accent.goldText : colors.text.tertiary} />
      </View>
      <AppText variant="ui.label" tone={active ? 'gold' : 'tertiary'} style={styles.label}>
        {route.label}
      </AppText>
    </Pressable>
  );
}

const useStyles = createThemedStyles((colors) => ({
  bottomItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xs,
  },
  railItem: {
    alignItems: 'center',
    paddingVertical: spacing.md,
  },
  itemPressed: {
    opacity: 0.7,
  },
  pill: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
  },
  pillActive: {
    backgroundColor: colors.chip.square,
  },
  label: {
    marginTop: spacing.xs,
  },
}));
