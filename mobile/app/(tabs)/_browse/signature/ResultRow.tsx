import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { AppText, FittedArt } from '../../../../components';
import { createThemedStyles } from '../../../../theme/ThemeContext';
import { spacing } from '../../../../theme/spacing';
import { leaf } from '../../_home/signature/leaf';

const ART_WIDTH = 72;
const ART_HEIGHT = 44;
const ART_SHAPE = leaf(12, 3);

export interface ResultRowProps {
  title: string;
  /** Short upper-case line under the title: kind, category, length or episode count. */
  meta: string;
  onPress: () => void;
  thumbnailUrl?: string | null;
  /** Drawn in the art slot instead of a thumbnail (a speaker's avatar). */
  art?: React.ReactNode;
}

/** One search result on Signature Browse: a small leaf-shaped thumbnail, title and meta. */
export function ResultRow({ title, meta, onPress, thumbnailUrl, art }: ResultRowProps) {
  const styles = useStyles();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${meta.toLowerCase()}`}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      {art ? (
        <View style={styles.artSlot}>{art}</View>
      ) : (
        <View style={[styles.artSlot, styles.art, ART_SHAPE]}>
          {thumbnailUrl ? (
            <FittedArt uri={thumbnailUrl} />
          ) : null}
        </View>
      )}
      <View style={styles.text}>
        <AppText variant="ui.bodyLarge" numberOfLines={1}>
          {title}
        </AppText>
        <AppText variant="mono.meta" tone="tertiary" numberOfLines={1}>
          {meta}
        </AppText>
      </View>
    </Pressable>
  );
}

const useStyles = createThemedStyles((colors) => ({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 72,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border.default,
  },
  pressed: {
    opacity: 0.7,
  },
  artSlot: {
    width: ART_WIDTH,
    height: ART_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  art: {
    overflow: 'hidden',
    backgroundColor: colors.surface.sunken,
  },
  text: {
    flex: 1,
    gap: 2,
  },
}));
