import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { AppText } from '../Text';
import { IconButton } from '../IconButton';
import { spacing } from '../../theme/spacing';
import { formatDuration } from '../../lib/format/duration';
import type { NotePublic } from '../../lib/query/hooks/useNotes';

export interface NoteListItemProps {
  note: NotePublic;
  /** Sermon title, resolved by the caller (a note itself only carries `sermon_id`) — omitted when the caller couldn't resolve it (e.g. a sermon since removed from the catalog). */
  sermonTitle?: string;
  onPress?: () => void;
  onDelete?: () => void;
}

/**
 * Mono timestamp ("14:22 →") + note text (design spec §4's "Notes-timeline list item"
 * shared primitive) — used identically by the standalone Notes list (`app/notes.tsx`)
 * and the tablet two-pane "Your notes" panel (`app/(tabs)/me.tsx`). The Player drawer's
 * own use of this same primitive is W4.2's job, not built here.
 */
export function NoteListItem({ note, sermonTitle, onPress, onDelete }: NoteListItemProps) {
  const timestamp = `${formatDuration(note.position_seconds)} →`;

  return (
    <Pressable onPress={onPress} disabled={!onPress} style={styles.row}>
      <View style={styles.textBlock}>
        <View style={styles.metaRow}>
          <AppText variant="mono.tight" tone="gold">
            {timestamp}
          </AppText>
          {sermonTitle ? (
            <AppText variant="mono.meta" tone="tertiary" numberOfLines={1} style={styles.sermonTitle}>
              {sermonTitle}
            </AppText>
          ) : null}
        </View>
        <AppText variant="ui.body" numberOfLines={3}>
          {note.body}
        </AppText>
      </View>
      {onDelete ? (
        <IconButton icon="trash-outline" size={18} accessibilityLabel="Delete note" onPress={onDelete} />
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    paddingVertical: spacing.md,
  },
  textBlock: {
    flex: 1,
    gap: spacing.xs,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  sermonTitle: {
    flexShrink: 1,
  },
});
