import React from 'react';
import { View } from 'react-native';
import { createThemedStyles } from '../../theme/ThemeContext';
import { usePlatformOS } from './platform';
import { FloatingDock } from './FloatingDock';
import { MiniPlayer } from './MiniPlayer';
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
        <View style={styles.content}>
          <View style={styles.content}>{children}</View>
          <MiniPlayer />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.stackedLayout}>
      <View style={styles.content}>{children}</View>
      {/* Daybreak redesign: one floating dock on both phone platforms, with the mini
          player above it while a sermon plays on. */}
      <MiniPlayer />
      <FloatingDock />
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
