import React from 'react';
import { StyleSheet, View } from 'react-native';
import { usePathname, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../../theme/colors';
import { spacing } from '../../theme/spacing';
import { IconNavItem } from './IconNavItem';
import { PHONE_NAV_KEYS, isRouteActive, routeByKey } from './routes';

/**
 * Android Material 3 nav bar (design spec §1.2/§2): icon + always-visible label, pill
 * active indicator. Same five destinations as iOS (P1: "Downloads" everywhere) — only
 * the chrome differs.
 */
export function PhoneTabBarAndroid() {
  const pathname = usePathname();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const routes = PHONE_NAV_KEYS.map(routeByKey);

  return (
    <View
      testID="phone-tab-bar-android"
      style={[styles.bar, { paddingBottom: Math.max(insets.bottom, spacing.sm) }]}
    >
      {routes.map((route) => (
        <IconNavItem
          key={route.key}
          route={route}
          active={isRouteActive(pathname, route)}
          onPress={() => router.push(route.href)}
          orientation="bottom"
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    backgroundColor: colors.surface.nav,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border.default,
    paddingTop: spacing.sm,
  },
});
