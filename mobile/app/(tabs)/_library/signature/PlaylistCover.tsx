import React from 'react';
import { Image, StyleSheet, View, type ViewStyle } from 'react-native';
import { AppText } from '../../../../components';
import { createThemedStyles, useTheme } from '../../../../theme/ThemeContext';
import { Flame } from '../../_home/signature/Flame';

export interface PlaylistCoverProps {
  name: string;
  coverUrl: string | null | undefined;
  size: number;
  shape: ViewStyle;
}

/**
 * A playlist's cover, or — before one is uploaded — the playlist's initial set in
 * Newsreader on a gold wash with a small flame, so an uncovered playlist still reads as
 * the user's own object rather than an empty tile.
 */
export function PlaylistCover({ name, coverUrl, size, shape }: PlaylistCoverProps) {
  const { colors } = useTheme();
  const styles = useStyles();
  const initial = name.trim().charAt(0).toUpperCase() || '·';
  return (
    <View style={[styles.box, shape, { width: size, height: size }]}>
      {coverUrl ? (
        <Image source={{ uri: coverUrl }} style={StyleSheet.absoluteFill} resizeMode="cover" />
      ) : (
        <View style={styles.fallback} accessible={false} importantForAccessibility="no-hide-descendants">
          <AppText variant="display.hero" tone="gold" style={{ fontSize: size * 0.42, lineHeight: size * 0.5 }}>
            {initial}
          </AppText>
          <View style={styles.flame}>
            <Flame width={Math.max(6, size * 0.08)} fill={colors.accent.gold} />
          </View>
        </View>
      )}
    </View>
  );
}

const useStyles = createThemedStyles((colors) => ({
  box: {
    overflow: 'hidden',
    backgroundColor: colors.chip.circle,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border.card,
  },
  fallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  flame: {
    position: 'absolute',
    top: '12%',
    right: '12%',
  },
}));
