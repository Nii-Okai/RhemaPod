import React from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { QueryState } from '../components';
import { NoteListItem } from '../components/notes/NoteListItem';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { useMyNotes, useDeleteNote } from '../lib/query/hooks/useNotes';
import { useSermons } from '../lib/query/hooks/useSermons';
import { buildSermonTitleMap } from '../lib/format/sermonTitleMap';

/**
 * Full "my notes" list (design spec §4's Notes-timeline list item primitive, the
 * destination of Profile & Settings' Library "Notes" row, P8: no count on that row —
 * this screen is where the actual notes live). `GET /me/notes` is unpaginated
 * (§A.5/`list_my_notes`'s own generated schema has no query params) — every note the
 * caller has ever taken, most-recent-first.
 */
export default function NotesScreen() {
  const router = useRouter();
  const notesQuery = useMyNotes();
  const sermonsQuery = useSermons();
  const deleteNote = useDeleteNote();

  const sermonTitles = buildSermonTitleMap(sermonsQuery.data ?? []);
  const notes = notesQuery.data ?? [];

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title: 'My notes' }} />
      <QueryState
        isLoading={notesQuery.isLoading}
        isError={notesQuery.isError}
        error={notesQuery.error}
        isEmpty={!notesQuery.isLoading && !notesQuery.isError && notes.length === 0}
        emptyTitle="No notes yet"
        emptyDescription="Notes you take while listening will show up here."
        onRetry={() => notesQuery.refetch()}
        loadingLabel="Loading notes"
      >
        {notes.map((note) => (
          <NoteListItem
            key={note.id}
            note={note}
            sermonTitle={sermonTitles.get(note.sermon_id)?.title}
            onPress={() => router.push({ pathname: '/sermon/[id]', params: { id: note.sermon_id } })}
            onDelete={() => deleteNote.mutate(note.id)}
          />
        ))}
      </QueryState>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.surface.app,
  },
  content: {
    padding: spacing.lg,
    paddingBottom: spacing.xxl * 2,
  },
});
