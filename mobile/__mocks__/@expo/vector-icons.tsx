import React from 'react';
import { Text } from 'react-native';

/**
 * Manual Jest mock for `@expo/vector-icons`. Real Ionicons glyph rendering depends on
 * native font-loading machinery `jest-expo` doesn't stand up in this project's test
 * environment — tests that render nav chrome care about which chrome mounts and which
 * route each item points at (covered structurally by `routes.test.ts`), not glyph
 * rendering, so this swaps in a bare stand-in rendering the icon name as text.
 */
export function Ionicons({ name }: { name: string }) {
  return <Text>{name}</Text>;
}
