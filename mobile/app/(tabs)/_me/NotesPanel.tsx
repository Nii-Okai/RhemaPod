import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { AppText, LinkButton } from '../../../components';
import { NoteListItem } from '../../../components/notes/NoteListItem';
import { colors } from '../../../theme/colors';
import { spacing } from '../../../theme/spacing';
import type { NotePublic } from '../../../lib/query/hooks/useNotes';
import type { SermonListItem } from '../../../lib/query/hooks/useSermons';

export interface NotesPanelProps {
  notes: NotePublic[];
  sermonTitles: Map<string, SermonListItem>;
  isLoading: boolean;
  isError: boolean;
  onSeeAll: () => void;
  /** How many of the caller's most-recent notes to show inline — the rest are only reached via "See all". */
  maxItems?: number;
}

/**
 * "Your notes" — the tablet two-pane's inline companion panel (design spec 1o).
 *
 * Scope note (flagged, not silently decided): 1o's full composition is "rail nav + a
 * docked player pane beside an episode list" — that docked *player* pane doesn't exist
 * yet (`app/player/[id].tsx` is still W4.2's placeholder; no video surface, no episode
 * list to dock it next to). This panel is the one piece of 1o's tablet-only composition
 * that both (a) belongs to a screen this ticket (W4.6) actually owns — Profile & Settings
 * — and (b) has real backend data behind it today (`GET /me/notes`). It renders here as
 * Profile & Settings' own tablet-two-pane companion, not as a stand-in for the Player
 * screen's docked video pane, which is W4.2's scope to build. See `status.md` for the
 * full writeup of this scope boundary.
 */
export function NotesPanel({ notes, sermonTitles, isLoading, isError, onSeeAll, maxItems = 6 }: NotesPanelProps) {
  const items = notes.slice(0, maxItems);

  return (
    <View style={styles.panel} testID="notes-panel">
      <AppText variant="display.row" style={styles.heading}>
        Your notes
      </AppText>

      {isLoading ? (
        <AppText variant="ui.body" tone="secondary">
          Loading notes…
        </AppText>
      ) : isError ? (
        <AppText variant="ui.body" tone="secondary">
          Couldn't load your notes.
        </AppText>
      ) : items.length === 0 ? (
        <AppText variant="ui.body" tone="secondary">
          No notes yet. Notes you take while listening will show up here.
        </AppText>
      ) : (
        <ScrollView style={styles.list}>
          {items.map((note) => (
            <NoteListItem key={note.id} note={note} sermonTitle={sermonTitles.get(note.sermon_id)?.title} />
          ))}
        </ScrollView>
      )}

      {notes.length > 0 ? (
        <View style={styles.seeAll}>
          <LinkButton label="See all notes" onPress={onSeeAll} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    flex: 1,
    backgroundColor: colors.surface.raised,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: colors.border.default,
    padding: spacing.lg,
  },
  heading: {
    marginBottom: spacing.md,
  },
  list: {
    flex: 1,
  },
  seeAll: {
    marginTop: spacing.md,
    alignSelf: 'flex-start',
  },
});
