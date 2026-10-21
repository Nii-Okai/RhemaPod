import React from 'react';
import { View } from 'react-native';
import { createThemedStyles } from '../../theme/ThemeContext';
import { usePlatformOS } from './platform';
import { PhoneTabBarAndroid } from './PhoneTabBarAndroid';
import { PhoneTabBarIOS } from './PhoneTabBarIOS';
import { TabletRail } from './TabletRail';
import { resolveChromeVariant, useDeviceClass } from './useDeviceClass';

export interface NavShellProps {
  children: React.ReactNode;
}

/**
 * The chrome-selection root for the `(tabs)` route group (plan L15/§A.7, W3.4). Every
 * platform and window size renders the exact same routed content (`children`, the
 * group's `<Slot />`) — only the surrounding navigation chrome differs, resolved from
 * live window width (never device-model detection, see `useDeviceClass`) plus
 * `Platform.OS`.
 */
export function NavShell({ children }: NavShellProps) {
  const styles = useStyles();
  const deviceClass = useDeviceClass();
  const os = usePlatformOS();
  const variant = resolveChromeVariant(deviceClass, os);

  if (variant === 'tablet-rail') {
    return (
      <View style={styles.railLayout}>
        <TabletRail />
        <View style={styles.content}>{children}</View>
      </View>
    );
  }

  return (
    <View style={styles.stackedLayout}>
      <View style={styles.content}>{children}</View>
      {variant === 'ios-tabs' ? <PhoneTabBarIOS /> : <PhoneTabBarAndroid />}
    </View>
  );
}

const useStyles = createThemedStyles((colors) => ({
  stackedLayout: {
    flex: 1,
    backgroundColor: colors.surface.app,
  },
  railLayout: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: colors.surface.app,
  },
  content: {
    flex: 1,
  },
}));
