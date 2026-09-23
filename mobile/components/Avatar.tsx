import React from 'react';
import { StyleSheet, View } from 'react-native';
import { colors } from '../theme/colors';
import { AppText } from './Text';

export interface AvatarProps {
  /** Full name (or similar) used to derive initials. */
  name: string;
  /** Stable id to hash into the rotating palette — falls back to `name`. */
  seed?: string;
  size?: 38 | 40;
}

export function initialsFrom(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0]}${parts[parts.length - 1]![0]}`.toUpperCase();
}

/**
 * Deterministic, stable-but-arbitrary palette index per seed — no semantic meaning is
 * encoded (spec §1.1/§5 item 6: the source shows no assignment logic, this is the
 * recommended default pending a product decision).
 */
export function hashToIndex(seed: string, bucketCount: number): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return hash % bucketCount;
}

/** Circular initials chip (spec §4), rotating bg from `colors.avatarPalette`. */
export function Avatar({ name, seed, size = 40 }: AvatarProps) {
  const bg = colors.avatarPalette[hashToIndex(seed ?? name, colors.avatarPalette.length)];

  return (
    <View
      accessible
      accessibilityLabel={name}
      style={[styles.base, { width: size, height: size, borderRadius: size / 2, backgroundColor: bg }]}
    >
      <AppText variant="ui.avatarInitials" tone="gold">
        {initialsFrom(name)}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
