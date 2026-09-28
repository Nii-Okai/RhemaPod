import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { usePathname, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../../theme/colors';
import { spacing } from '../../theme/spacing';
import { IconNavItem } from './IconNavItem';
import { TABLET_RAIL_KEYS, isRouteActive, routeByKey } from './routes';

/**
 * Tablet rail (design spec §2/1o, plan W3.4): six destinations, not a re-skin of the
 * phone tab set — `series`/`announcements` have no phone equivalent by design (planner
 * resolution P3). The avatar row at the foot opens Profile & Settings in place of a
 * dedicated `me` rail item (design spec §2). It's a static icon affordance here, not
 * wired to real profile data — pulling the signed-in user's name/avatar is Phase 4's
 * job; this item is chrome/routing only and does no data fetching.
 */
export function TabletRail() {
  const pathname = usePathname();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const routes = TABLET_RAIL_KEYS.map(routeByKey);
  const meRoute = routeByKey('me');
  const meActive = isRouteActive(pathname, meRoute);

  return (
    <View
      testID="tablet-rail"
      style={[styles.rail, { paddingTop: insets.top + spacing.lg, paddingBottom: insets.bottom + spacing.lg }]}
    >
      <View>
        {routes.map((route) => (
          <IconNavItem
            key={route.key}
            route={route}
            active={isRouteActive(pathname, route)}
            onPress={() => router.push(route.href)}
            orientation="rail"
          />
        ))}
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Profile & settings"
        accessibilityState={{ selected: meActive }}
        onPress={() => router.push(meRoute.href)}
        style={({ pressed }) => [styles.avatarChip, pressed && styles.avatarChipPressed]}
      >
        <Ionicons name="person" size={20} color={colors.accent.goldText} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  rail: {
    width: 88,
    backgroundColor: colors.surface.nav,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: colors.border.default,
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  avatarChip: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.chip.circle,
  },
  avatarChipPressed: {
    opacity: 0.7,
  },
});
