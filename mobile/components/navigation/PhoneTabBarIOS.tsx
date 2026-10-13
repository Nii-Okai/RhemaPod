import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { usePathname, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../../theme/colors';
import { spacing } from '../../theme/spacing';
import { AppText } from '../Text';
import { NavIcon } from './NavIcon';
import { PHONE_NAV_KEYS, isRouteActive, routeByKey } from './routes';

/**
 * iOS 5-tab bar: icon above a label (Isaac's ask, session 2026-10-11: "show icons on
 * bottom tabs ... device specific icons" — this was previously text-only by a deliberate
 * earlier design call, now reversed). Deliberately its OWN plainer treatment, not a
 * reuse of `IconNavItem` (Android bottom bar + tablet rail's own component) — standard
 * iOS tab bars convey the active item by tint color alone, with no M3-style pill chip
 * behind it; reusing `IconNavItem` verbatim would read as a reskinned Android bar rather
 * than a native iOS one. The icon glyphs themselves still come from `NavIcon`/
 * `PlatformIcon`, which already resolve to the iOS-appropriate Ionicons name — "device
 * specific" is the glyph choice, not just whether an icon shows at all. Reads the same
 * `PHONE_NAV_KEYS` list Android does (plan L15: routes never fork).
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
            <NavIcon route={route} active={active} size={22} color={active ? colors.accent.goldText : colors.text.tertiary} />
            <AppText variant="ui.label" tone={active ? 'gold' : 'tertiary'} style={styles.label}>
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
  label: {
    marginTop: 2,
  },
});
