import React from 'react';
import { Text } from 'react-native';

/**
 * Manual Jest mock for `@expo/vector-icons`. Real Ionicons/MaterialIcons glyph rendering
 * depends on native font-loading machinery `jest-expo` doesn't stand up in this
 * project's test environment — tests that render nav chrome or `PlatformIcon` care about
 * which chrome mounts and which name got resolved (the iOS/Android split
 * `PlatformIcon.test.tsx` covers directly), not actual glyph rendering, so this swaps in
 * a bare stand-in rendering the icon name as text, same shape for both families.
 */
export function Ionicons({ name, testID }: { name: string; testID?: string }) {
  return <Text testID={testID}>{name}</Text>;
}

export function MaterialIcons({ name, testID }: { name: string; testID?: string }) {
  return <Text testID={testID}>{name}</Text>;
}
