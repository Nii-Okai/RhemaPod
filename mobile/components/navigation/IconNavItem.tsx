import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../../theme/colors';
import { radius } from '../../theme/radius';
import { spacing } from '../../theme/spacing';
import { AppText } from '../Text';
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
 * the only two chromes that show icons at all (iOS stays text-only, spec §1.2).
 */
export function IconNavItem({ route, active, onPress, orientation }: IconNavItemProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={route.label}
      onPress={onPress}
      style={orientation === 'bottom' ? styles.bottomItem : styles.railItem}
    >
      <View style={[styles.pill, active && styles.pillActive]}>
        <Ionicons
          name={active ? route.iconActive : route.icon}
          size={22}
          color={active ? colors.accent.goldText : colors.text.tertiary}
        />
      </View>
      <AppText variant="ui.label" tone={active ? 'gold' : 'tertiary'} style={styles.label}>
        {route.label}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
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
});
