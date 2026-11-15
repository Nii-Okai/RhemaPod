import React from 'react';

/**
 * Manual Jest mock for `expo-blur`. The real view is a native UIVisualEffectView that
 * `jest-expo`'s environment doesn't stand up; tests only care that the frosted layer is
 * there and which tint it asked for, so `BlurView` renders a host element with its props.
 */
type Props = Record<string, unknown> & { children?: React.ReactNode };

export function BlurView(props: Props) {
  return React.createElement('ExpoBlurView', props);
}
