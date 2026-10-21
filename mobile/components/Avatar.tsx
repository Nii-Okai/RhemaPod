import React from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { AppText } from './Text';

export interface AvatarProps {
  /** Full name (or similar) used to derive initials. */
  name: string;
  /** Stable id to hash into the rotating palette — falls back to `name`. */
  seed?: string;
  size?: number;
  /** A real profile picture (session 2026-10-09) — renders instead of the initials
   * chip when present. `null`/`undefined` keeps the original initials-only
   * behavior; every existing call site is unaffected by this addition. */
  imageUri?: string | null;
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

/** Circular initials chip (spec §4), rotating bg from `colors.avatarPalette` — or, when
 * `imageUri` is set, the user's own profile picture instead. */
export function Avatar({ name, seed, size = 40, imageUri }: AvatarProps) {
  const { colors } = useTheme();
  if (imageUri) {
    return (
      <Image
        source={{ uri: imageUri }}
        accessible
        accessibilityLabel={name}
        style={[styles.base, { width: size, height: size, borderRadius: size / 2 }]}
      />
    );
  }

  const bg = colors.avatarPalette[hashToIndex(seed ?? name, colors.avatarPalette.length)];
  // `ui.avatarInitials`' own 14px is tuned for this component's usual 38-40px size (every
  // call site but one) — at a genuinely small size (`playlist/[id].tsx`'s 22px owner
  // avatar), a fixed 14px two-letter string leaves almost no margin before the circle's
  // own curve, reading as "touching the edge" (Isaac's ask, session 2026-10-10) rather
  // than comfortably centered. Scaling down (never up) keeps every existing 38-40px
  // avatar pixel-identical while giving a small one real breathing room.
  const fontSize = Math.min(14, Math.round(size * 0.4));

  return (
    <View
      accessible
      accessibilityLabel={name}
      style={[styles.base, { width: size, height: size, borderRadius: size / 2, backgroundColor: bg }]}
    >
      <AppText
        variant="ui.avatarInitials"
        tone="gold"
        style={fontSize < 14 ? { fontSize, lineHeight: fontSize * 1.2 } : undefined}
      >
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
