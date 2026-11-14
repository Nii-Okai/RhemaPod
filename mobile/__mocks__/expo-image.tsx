import React from 'react';

/**
 * Manual Jest mock for `expo-image`. The real view is a native SDWebImage/Glide view that
 * `jest-expo`'s environment doesn't stand up. Tests only care which art is drawn and how
 * it's fitted, so `Image` renders a host element carrying the same props, and the load
 * event is fired in tests with the payload `expo-image` itself passes (`{ source: {...} }`,
 * no `nativeEvent` wrapper).
 */
type Props = Record<string, unknown> & { children?: React.ReactNode };

function ImageImpl(props: Props) {
  return React.createElement('ExpoImage', props);
}

export const Image = Object.assign(ImageImpl, {
  prefetch: jest.fn(() => Promise.resolve(true)),
  clearMemoryCache: jest.fn(() => Promise.resolve(true)),
  clearDiskCache: jest.fn(() => Promise.resolve(true)),
});

export function ImageBackground(props: Props) {
  return React.createElement('ExpoImageBackground', props);
}

export function useImage() {
  return null;
}
