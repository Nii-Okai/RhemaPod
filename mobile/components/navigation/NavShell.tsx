import React, { useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { createThemedStyles, useTheme } from '../../theme/ThemeContext';
import { BottomChromeInsetProvider } from '../Frosted';
import { usePlatformOS } from './platform';
import { FloatingDock } from './FloatingDock';
import { MiniPlayer, MiniPlayerSlot } from './MiniPlayer';
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
  // Where the docked mini player's bottom edge sits, measured from its slot; the card
  // itself floats in a layer over the whole shell so it can be dragged anywhere.
  const [homeBottom, setHomeBottom] = useState<number | null>(null);
  const miniPlayer = homeBottom === null ? null : <MiniPlayer homeBottom={homeBottom} />;
  const [chromeTop, setChromeTop] = useState<number | null>(null);
  const [chromeHeight, setChromeHeight] = useState(0);
  const [slotBottom, setSlotBottom] = useState<number | null>(null);

  if (variant === 'tablet-rail') {
    return (
      <View style={styles.railLayout}>
        <TabletRail />
        <View style={styles.content}>
          <View style={styles.content}>{children}</View>
          <MiniPlayerSlot onHomeBottom={setHomeBottom} />
          {miniPlayer}
        </View>
      </View>
    );
  }

  // Phones: the screen runs the full height, under the frosted dock (and the docked mini
  // player's band above it), so the page blurs through as it scrolls. Each tab ends its
  // scroll above the chrome with `useBottomChromeInset`. The slot still sits in the
  // chrome's column, so `homeBottom` is the column's top plus the slot's foot.
  const homeBottomOnPhone = chromeTop === null || slotBottom === null ? null : chromeTop + slotBottom;
  const phoneMiniPlayer = homeBottomOnPhone === null ? null : <MiniPlayer homeBottom={homeBottomOnPhone} />;
  return (
    <View style={styles.stackedLayout}>
      <BottomChromeInsetProvider value={chromeHeight}>
        <View style={StyleSheet.absoluteFill}>{children}</View>
      </BottomChromeInsetProvider>
      {/* Daybreak redesign: one floating dock on both phone platforms, with the mini
          player above it while a sermon plays on (draggable, see `MiniPlayer`). */}
      <View
        testID="bottom-chrome"
        style={styles.bottomChrome}
        onLayout={(event: LayoutChangeEvent) => {
          const { y, height } = event.nativeEvent.layout;
          setChromeTop(y);
          setChromeHeight(height);
        }}
      >
        <BottomScrim />
        <MiniPlayerSlot onHomeBottom={setSlotBottom} />
        <FloatingDock />
      </View>
      {phoneMiniPlayer}
    </View>
  );
}

/**
 * A soft fade into the page colour behind the bottom chrome, so text scrolling past either
 * side of the floating dock dims out rather than running hard into the screen's foot.
 * Solid colour with stop opacities: SVG stops drop an rgba alpha on device (see
 * `colors.feature`).
 */
function BottomScrim() {
  const { colors } = useTheme();
  return (
    <Svg pointerEvents="none" style={StyleSheet.absoluteFill} width="100%" height="100%" preserveAspectRatio="none">
      <Defs>
        <LinearGradient id="bottom-scrim" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={colors.frost.scrim} stopOpacity={0} />
          <Stop offset="0.45" stopColor={colors.frost.scrim} stopOpacity={0.35} />
          <Stop offset="1" stopColor={colors.frost.scrim} stopOpacity={0.85} />
        </LinearGradient>
      </Defs>
      <Rect x="0" y="0" width="100%" height="100%" fill="url(#bottom-scrim)" />
    </Svg>
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
  bottomChrome: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
  },
}));
