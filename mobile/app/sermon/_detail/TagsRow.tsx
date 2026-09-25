import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Tag } from '../../../components';
import { spacing } from '../../../theme/spacing';

export interface TagsRowProps {
  tags: string[];
}

/**
 * Sermon-detail tags row (design spec §8.1.9) — horizontal wrap of inert `Tag` chips. The
 * caller omits this component entirely when `tags` is empty; this only lays out whatever
 * it's given.
 */
export function TagsRow({ tags }: TagsRowProps) {
  return (
    <View style={styles.row}>
      {tags.map((tag) => (
        <Tag key={tag} label={tag} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
});
