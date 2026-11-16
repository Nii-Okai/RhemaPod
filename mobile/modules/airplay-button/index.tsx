import React from 'react';
import { Platform, type ViewProps } from 'react-native';
import { requireNativeView, requireOptionalNativeModule } from 'expo';

interface NativeProps extends ViewProps {
  tintColor?: string;
  activeTintColor?: string;
  prioritizesVideoDevices?: boolean;
}

/*
 * iOS only, and only in builds that include this module. A JavaScript update can reach an
 * older build without it, so its absence must mean "no button", never a crash.
 */
const NativeAirPlayButton = Platform.OS === 'ios' && hasNativeModule() ? requireNativeView<NativeProps>('AirPlayButton') : null;

function hasNativeModule(): boolean {
  try {
    return requireOptionalNativeModule('AirPlayButton') != null;
  } catch {
    // jest-expo's module mocks throw for a module they don't know, rather than return null.
    return false;
  }
}

export const isAirPlayAvailable = NativeAirPlayButton != null;

export interface AirPlayButtonProps {
  /** Width and height of the button, in points. */
  size?: number;
  /** The glyph's colour. */
  tintColor: string;
  /** The glyph's colour while playing on an AirPlay device. */
  activeTintColor: string;
  /** True for a video sermon, so Apple TVs come first in the device sheet. */
  video?: boolean;
  testID?: string;
}

/**
 * The system AirPlay button, or nothing where AirPlay isn't available (Android, old builds).
 * VoiceOver reads the native button's own "AirPlay" label, so none is set here.
 */
export function AirPlayButton({ size = 42, tintColor, activeTintColor, video = false, testID }: AirPlayButtonProps) {
  if (!NativeAirPlayButton) return null;
  return (
    <NativeAirPlayButton
      testID={testID}
      style={{ width: size, height: size }}
      tintColor={tintColor}
      activeTintColor={activeTintColor}
      prioritizesVideoDevices={video}
    />
  );
}
