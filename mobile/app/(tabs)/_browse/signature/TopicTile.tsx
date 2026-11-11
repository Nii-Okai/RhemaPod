import React from 'react';
import { StyleSheet, View } from 'react-native';
import { AppText, PressableScale } from '../../../../components';
import type { ColorTokens } from '../../../../theme/colors';
import { spacing } from '../../../../theme/spacing';
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

const TILE_HEIGHT = 92;

export interface TopicTileProps {
  category: Category;
  tone: TopicTone;
  onPress: () => void;
}

/**
 * One colour-coded category tile on Discover (Daybreak redesign, canvas B3): the name in
 * bold over its sermon count, with a faint disc of the same colour tucked into the corner.
 */
export function TopicTile({ category, tone, onPress }: TopicTileProps) {
  return (
    <PressableScale
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${category.name}, ${countLabel(category.sermon_count)}`}
      style={[styles.tile, { backgroundColor: tone.bg }]}
    >
      <View style={[styles.disc, { backgroundColor: tone.fg }]} pointerEvents="none" />
      <AppText variant="ui.bodyBold" numberOfLines={2} style={{ color: tone.fg }}>
        {category.name}
      </AppText>
      <AppText variant="ui.badge" style={{ color: tone.fg }}>
        {countLabel(category.sermon_count)}
      </AppText>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  tile: {
    height: TILE_HEIGHT,
    borderRadius: 20,
    overflow: 'hidden',
    padding: spacing.md + 2,
    justifyContent: 'space-between',
  },
  disc: {
    position: 'absolute',
    width: 80,
    height: 80,
    borderRadius: 40,
    right: -20,
    bottom: -30,
    opacity: 0.14,
  },
});
