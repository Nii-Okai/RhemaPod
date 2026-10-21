import React from 'react';
import { StyleSheet, View } from 'react-native';
import { AppText, PressableScale } from '../../../../components';
import type { ColorTokens } from '../../../../theme/colors';
import { spacing } from '../../../../theme/spacing';
import { Flame } from '../../_home/signature/Flame';
import { LEAF_SM } from '../../_home/signature/leaf';
import type { Category } from '../../../../lib/query/hooks/useCategories';

export interface TopicTone {
  bg: string;
  fg: string;
}

/**
 * The colours categories cycle through, from the theme's status pairs: wheat, slate,
 * rose, sage. Each pairing is AA-checked in both themes
 * (theme/__tests__/contrast.test.ts). Wheat has no `text` of its own; its `dot` is the
 * matching gold.
 */
export function topicTones(colors: ColorTokens): TopicTone[] {
  return [
    { bg: colors.status.wheat.bg, fg: colors.status.wheat.dot },
    { bg: colors.status.slate.bg, fg: colors.status.slate.text },
    { bg: colors.status.rose.bg, fg: colors.status.rose.text },
    { bg: colors.status.sage.bg, fg: colors.status.sage.text },
  ];
}

function countLabel(count: number): string {
  return count === 1 ? '1 sermon' : `${count} sermons`;
}

const TILE_HEIGHT = 80;

export interface TopicTileProps {
  category: Category;
  tone: TopicTone;
  onPress: () => void;
}

/**
 * One colour-coded category tile on Signature Browse: the name in the serif, with a large
 * faint flame tucked into the corner. As on the classic tile, the sermon count is read
 * out but not shown.
 */
export function TopicTile({ category, tone, onPress }: TopicTileProps) {
  return (
    <PressableScale
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${category.name}, ${countLabel(category.sermon_count)}`}
      style={[styles.tile, LEAF_SM, { backgroundColor: tone.bg }]}
    >
      <View style={styles.flame} pointerEvents="none">
        <Flame width={48} fill={tone.fg} />
      </View>
      <AppText variant="display.row" numberOfLines={2} style={{ color: tone.fg }}>
        {category.name}
      </AppText>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  tile: {
    height: TILE_HEIGHT,
    overflow: 'hidden',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  flame: {
    position: 'absolute',
    right: -6,
    bottom: -10,
    opacity: 0.35,
  },
});
