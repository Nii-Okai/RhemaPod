import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { usePathname, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Path } from 'react-native-svg';
import { createThemedStyles, useTheme } from '../../theme/ThemeContext';
import { spacing } from '../../theme/spacing';
import { AppText } from '../Text';
import { NavIcon } from './NavIcon';
import { PHONE_NAV_KEYS, isRouteActive, routeByKey, type NavRoute, type NavRouteKey } from './routes';

/** Where the raised Today button opens: today's Daily Rhema, resolved by the devotional screen. */
export const TODAY_HREF = '/devotional/today';

// Line icons from the Daybreak canvas, on a 24-unit box.
const GLYPHS: Partial<Record<NavRouteKey, (color: string) => React.ReactNode>> = {
  home: (color) => <Path d="M4 11l8-7 8 7v9a1 1 0 0 1-1 1h-4v-6h-6v6H5a1 1 0 0 1-1-1z" stroke={color} />,
  browse: (color) => (
    <>
      <Circle cx={12} cy={12} r={9} stroke={color} />
      <Path d="M15.5 8.5l-2 5-5 2 2-5z" stroke={color} />
    </>
  ),
  library: (color) => <Path d="M5 4v16M10 4v16M15 5l4 15" stroke={color} />,
};
const SUNRISE = 'M3 18h18M6.5 18a5.5 5.5 0 0 1 11 0M12 5v3M5.6 9.6l1.8 1.8M18.4 9.6l-1.8 1.8';

function LineIcon({ children, size }: { children: React.ReactNode; size: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      {children}
    </Svg>
  );
}

export interface FloatingDockProps {
  testID?: string;
}

/**
 * The phone tab bar (Daybreak redesign): a navy pill floating over the page's own ground,
 * Home · Discover · Today · Library · You, with Today raised in the middle as a gold disc
 * that opens today's Daily Rhema. Navy in both themes. The active tab turns white with a
 * small gold dot under it; the "You" tab keeps the caller's own avatar (`NavIcon`).
 *
 * Same on iOS and Android: the redesign replaces both platform bars with one brand chrome,
 * and still reads the one `PHONE_NAV_KEYS` list (plan L15: routes never fork).
 */
export function FloatingDock({ testID = 'floating-dock' }: FloatingDockProps) {
  const { colors } = useTheme();
  const styles = useStyles();
  const pathname = usePathname();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const routes = PHONE_NAV_KEYS.map(routeByKey);
  const middle = Math.ceil(routes.length / 2);
  const todayActive = pathname.startsWith('/devotional');

  const item = (route: NavRoute) => {
    const active = isRouteActive(pathname, route);
    const color = active ? colors.dock.iconActive : colors.dock.icon;
    const glyph = GLYPHS[route.key];
    return (
      <Pressable
        key={route.key}
        accessibilityRole="button"
        accessibilityLabel={route.label}
        accessibilityState={{ selected: active }}
        onPress={() => router.push(route.href)}
        style={({ pressed }) => [styles.item, pressed && styles.pressed]}
      >
        {glyph ? <LineIcon size={22}>{glyph(color)}</LineIcon> : <NavIcon route={route} active={active} size={22} color={color} />}
        <AppText variant="ui.actionLabel" style={{ color }}>
          {route.label}
        </AppText>
        <View style={[styles.dot, active && styles.dotActive]} />
      </Pressable>
    );
  };

  return (
    <View testID={testID} style={[styles.wrap, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
      <View style={styles.dock}>
        {routes.slice(0, middle).map(item)}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Today, Daily Rhema"
          accessibilityState={{ selected: todayActive }}
          onPress={() => router.push(TODAY_HREF)}
          style={({ pressed }) => [styles.today, pressed && styles.pressed]}
        >
          <LineIcon size={26}>
            <Path d={SUNRISE} stroke={colors.dock.todayIcon} />
          </LineIcon>
        </Pressable>
        {routes.slice(middle).map(item)}
      </View>
    </View>
  );
}

const DOCK_HEIGHT = 68;
const TODAY_SIZE = 62;

const useStyles = createThemedStyles((colors) => ({
  wrap: {
    backgroundColor: colors.surface.app,
    paddingHorizontal: spacing.md + 2,
    paddingTop: spacing.lg + 2,
  },
  dock: {
    height: DOCK_HEIGHT,
    borderRadius: DOCK_HEIGHT / 2,
    backgroundColor: colors.dock.bg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.dock.border,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingHorizontal: spacing.sm,
    shadowColor: colors.dock.shadow,
    shadowOpacity: 1,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 12 },
    elevation: 12,
  },
  item: {
    width: 58,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    paddingTop: 6,
  },
  pressed: {
    opacity: 0.7,
  },
  dot: {
    width: 4,
    height: 4,
    borderRadius: 2,
  },
  dotActive: {
    backgroundColor: colors.dock.dot,
  },
  today: {
    width: TODAY_SIZE,
    height: TODAY_SIZE,
    borderRadius: TODAY_SIZE / 2,
    marginTop: -30,
    backgroundColor: colors.dock.todayBg,
    borderWidth: 4,
    borderColor: colors.dock.todayRing,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.dock.todayBg,
    shadowOpacity: 0.45,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
}));
