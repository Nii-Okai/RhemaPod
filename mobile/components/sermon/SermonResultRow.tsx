import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { AppText } from '../Text';
import { spacing } from '../../theme/spacing';
import { formatDuration } from '../../lib/format/duration';
import type { components } from '../../lib/api/schema';

export type SermonListItem = components['schemas']['SermonListItem'];

export interface SermonResultRowProps {
  sermon: SermonListItem;
  onPress: () => void;
}

/** "42:18 · Ada Nwosu" (design spec 1j) — `formatDuration` always returns a string
 *  (`--:--` while the media pipeline is still probing), so this only ever omits the
 *  speaker segment, never the duration one. */
function metaLine(sermon: SermonListItem): string {
  const parts = [formatDuration(sermon.duration_seconds), sermon.speaker_name].filter(
    (part): part is string => Boolean(part),
  );
  return parts.join(' · ');
}

/**
 * One sermon row — shared by the Search tab's results (search.tsx) and the
 * Browse category/speaker drill-down lists (app/category/[id].tsx,
 * app/speaker/[id].tsx): identical composition, three call sites, per design
 * spec 1j ("Anchored in the Storm 42:18 · Ada Nwosu"). Title is `display.
 * compact` per theme/typography.ts's rule that list titles are Newsreader,
 * not Figtree.
 */
export function SermonResultRow({ sermon, onPress }: SermonResultRowProps) {
  const meta = metaLine(sermon);

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={meta ? `${sermon.title}, ${meta}` : sermon.title}
      style={styles.row}
    >
      <View style={styles.textBlock}>
        <AppText variant="display.compact" numberOfLines={2}>
          {sermon.title}
        </AppText>
        {meta ? (
          <AppText variant="mono.meta" tone="tertiary" style={styles.meta}>
            {meta}
          </AppText>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    paddingVertical: spacing.md,
  },
  textBlock: {
    gap: spacing.xs,
  },
  meta: {
    marginTop: 0,
  },
});
