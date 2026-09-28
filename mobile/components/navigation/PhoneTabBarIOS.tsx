import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { usePathname, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../../theme/colors';
import { spacing } from '../../theme/spacing';
import { AppText } from '../Text';
import { PHONE_NAV_KEYS, isRouteActive, routeByKey } from './routes';

/**
 * iOS 5-tab bar (design spec §1.2/§2): text-only labels, no icons — a deliberate,
 * confirmed platform divergence from Android's icon+label set, not an inconsistency to
 * fix. Reads the same `PHONE_NAV_KEYS` list Android does (plan L15: routes never fork).
 */
export function PhoneTabBarIOS() {
  const pathname = usePathname();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const routes = PHONE_NAV_KEYS.map(routeByKey);

  return (
    <View testID="phone-tab-bar-ios" style={[styles.bar, { paddingBottom: Math.max(insets.bottom, spacing.sm) }]}>
      {routes.map((route) => {
        const active = isRouteActive(pathname, route);
        return (
          <Pressable
            key={route.key}
            accessibilityRole="button"
            accessibilityLabel={route.label}
            accessibilityState={{ selected: active }}
            onPress={() => router.push(route.href)}
            style={({ pressed }) => [styles.item, pressed && styles.itemPressed]}
          >
            <AppText variant="ui.label" tone={active ? 'gold' : 'tertiary'}>
              {route.label}
            </AppText>
          </Pressable>
        );
      })}
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
  item: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xs,
  },
  itemPressed: {
    opacity: 0.7,
  },
});
