import React from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { AppText, Card } from '../../../components';
import { spacing } from '../../../theme/spacing';
import type { Category } from '../../../lib/query/hooks/useCategories';

export interface CategoryCardProps {
  category: Category;
  onPress: () => void;
}

function countLabel(count: number): string {
  return count === 1 ? '1 sermon' : `${count} sermons`;
}

/** Design spec 1i/2d: "Teaching · 54 sermons" — a Card composing the same title/meta
 *  pairing dev-gallery's "Card" section demonstrates. */
export function CategoryCard({ category, onPress }: CategoryCardProps) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${category.name}, ${countLabel(category.sermon_count)}`}
      style={styles.pressable}
    >
      <Card>
        <AppText variant="display.compact">{category.name}</AppText>
        <AppText variant="mono.meta" tone="tertiary" style={styles.meta}>
          {countLabel(category.sermon_count)}
        </AppText>
      </Card>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pressable: {
    marginBottom: spacing.md,
  },
  meta: {
    marginTop: spacing.xs,
  },
});
