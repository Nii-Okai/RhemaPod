import React from 'react';
import { Image, StyleSheet, type ViewStyle } from 'react-native';
import { PressableScale } from '../../../../components';
import { createThemedStyles } from '../../../../theme/ThemeContext';
import { LEAF_SM } from './leaf';

export interface ArtTileProps {
  thumbnailUrl: string | null | undefined;
  onPress: () => void;
  accessibilityLabel: string;
  /** Fixed shelf width, or omitted to fill the parent (grid tiles). */
  width?: number;
  aspectRatio: number;
  /** Corner shape; defaults to the small leaf. */
  shape?: ViewStyle;
  /** Drawn over the art (progress bar, chip, play button). */
  children?: React.ReactNode;
}

/**
 * The art block every Signature shelf card is built on. Sermon and series thumbnails
 * already carry their title in the artwork, so the card draws no title over it — only
 * self-contained overlays (`children`) go on top. `cover` fills the box; for a portrait
 * box the middle of the landscape art is what shows, as on the classic Trending shelf.
 */
export function ArtTile({
  thumbnailUrl,
  onPress,
  accessibilityLabel,
  width,
  aspectRatio,
  shape = LEAF_SM,
  children,
}: ArtTileProps) {
  const styles = useStyles();
  return (
    <PressableScale
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={[styles.tile, shape, width !== undefined ? { width } : styles.fill, { aspectRatio }]}
    >
      {thumbnailUrl ? (
        <Image source={{ uri: thumbnailUrl }} style={StyleSheet.absoluteFill} resizeMode="cover" />
      ) : null}
      {children}
    </PressableScale>
  );
}

const useStyles = createThemedStyles((colors) => ({
  tile: {
    overflow: 'hidden',
    backgroundColor: colors.surface.sunken,
  },
  fill: {
    width: '100%',
  },
}));
