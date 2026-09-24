import { useWindowDimensions, type Platform } from 'react-native';

/**
 * Plan L15/§A.7: the phone/tablet split reads live width off `useWindowDimensions`,
 * never device-model detection — so an iPad resized into narrow Split View correctly
 * falls back to the phone chrome instead of a cramped two-pane rail.
 */
export const TABLET_BREAKPOINT = 768;

export type DeviceClass = 'phone' | 'tablet';

export function deviceClassForWidth(width: number): DeviceClass {
  return width >= TABLET_BREAKPOINT ? 'tablet' : 'phone';
}

/** Re-evaluates on every dimension change (rotation, Split View resize) — see NavShell.test.tsx. */
export function useDeviceClass(): DeviceClass {
  const { width } = useWindowDimensions();
  return deviceClassForWidth(width);
}

export type ChromeVariant = 'ios-tabs' | 'android-tabs' | 'tablet-rail';

/**
 * Pure chrome-selection rule (kept side-effect-free so it's testable without rendering
 * anything — plan W3.4 verification). Tablet width wins regardless of platform; below
 * the breakpoint, platform decides the text-only iOS bar vs. the Material 3 Android bar.
 * Any other `Platform.OS` (web, during local dev) falls back to the Android chrome
 * rather than throwing.
 */
export function resolveChromeVariant(deviceClass: DeviceClass, os: typeof Platform.OS): ChromeVariant {
  if (deviceClass === 'tablet') return 'tablet-rail';
  return os === 'ios' ? 'ios-tabs' : 'android-tabs';
}
