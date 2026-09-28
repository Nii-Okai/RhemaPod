import React, { useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AppText, QueryState } from '../../../components';
import { NoteListItem } from '../../../components/notes/NoteListItem';
import { colors } from '../../../theme/colors';
import { radius } from '../../../theme/radius';
import { spacing } from '../../../theme/spacing';
import { usePlatformOS } from '../../../components/navigation/platform';
import { useCreateNote, useDeleteNote, useSermonNotes, useUpdateNote, type NotePublic } from '../../../lib/query/hooks/useNotes';
import { NoteComposer } from './NoteComposer';

export interface NotesDrawerProps {
  sermonId: string;
  /** A getter, not a prop value — reading it doesn't re-render this drawer on every
   * playback tick; only "+ Note" itself needs the position, read once at tap time. */
  getCurrentPositionSeconds: () => number;
}

type ComposerState = { mode: 'create'; positionSeconds: number } | { mode: 'edit'; note: NotePublic } | null;

/**
 * Player screen's Notes drawer (design spec §3 Player: "segmented drawer below (Notes /
 * Scripture / Transcript, iOS: segmented control; Android: underlined M3 tabs)"). Only
 * Notes survives to MVP — Scripture and Transcript are cut (plan L5/L266: no transcript
 * or cross-reference data exists anywhere). The single-segment header chrome below is
 * kept anyway, deliberately: the plan's own W4.2 bullet still names the platform-specific
 * segmented-control/underlined-tab treatment verbatim, and rendering it (functionally
 * inert, since there is exactly one destination) costs little and keeps the two platforms'
 * visual identity the spec actually drew, rather than silently dropping chrome the spec
 * asked for because only one of its three tabs survived a separate, already-made cut.
 */
export function NotesDrawer({ sermonId, getCurrentPositionSeconds }: NotesDrawerProps) {
  const os = usePlatformOS();
  const notesQuery = useSermonNotes(sermonId);
  const createNote = useCreateNote(sermonId);
  const updateNote = useUpdateNote(sermonId);
  const deleteNote = useDeleteNote(sermonId);
  const [composer, setComposer] = useState<ComposerState>(null);

  const notes = notesQuery.data ?? [];
  const activeMutation = composer?.mode === 'edit' ? updateNote : createNote;

  // Captured once, at tap time — not read live from the getter on every render, so the
  // timestamp shown in the composer can't drift away from the moment "+ Note" was
  // actually pressed while the sheet sits open.
  const openCreate = () =>
    setComposer({ mode: 'create', positionSeconds: Math.max(0, Math.round(getCurrentPositionSeconds())) });
  const openEdit = (note: NotePublic) => setComposer({ mode: 'edit', note });
  const closeComposer = () => setComposer(null);

  const handleSave = (body: string) => {
    if (composer?.mode === 'edit') {
      updateNote.mutate({ noteId: composer.note.id, data: { body } }, { onSuccess: closeComposer });
    } else if (composer?.mode === 'create') {
      createNote.mutate({ position_seconds: composer.positionSeconds, body }, { onSuccess: closeComposer });
    }
  };

  return (
    <View style={styles.drawer} testID="notes-drawer">
      <View style={os === 'android' ? styles.tabRowAndroid : styles.tabRowIos}>
        {os === 'android' ? (
          <AppText variant="ui.label" tone="gold" style={styles.tabLabelAndroid}>
            NOTES
          </AppText>
        ) : (
          <View style={styles.segmentPill}>
            <AppText variant="ui.label" tone="inverse">
              Notes
            </AppText>
          </View>
        )}
        {os !== 'android' ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Add note"
            onPress={openCreate}
            style={({ pressed }) => [styles.iosAddButton, pressed && styles.addButtonPressed]}
          >
            <Ionicons name="add" size={18} color={colors.accent.goldText} />
            <AppText variant="ui.button" tone="gold">
              Note
            </AppText>
          </Pressable>
        ) : null}
      </View>

      <QueryState
        isLoading={notesQuery.isLoading}
        isError={notesQuery.isError}
        error={notesQuery.error}
        isEmpty={!notesQuery.isLoading && !notesQuery.isError && notes.length === 0}
        emptyTitle="No notes yet"
        emptyDescription="Tap + Note to add one without pausing."
        onRetry={() => notesQuery.refetch()}
        loadingLabel="Loading notes"
      >
        <FlatList
          data={notes}
          keyExtractor={(note) => note.id}
          style={styles.list}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => (
            <NoteListItem note={item} onPress={() => openEdit(item)} onDelete={() => deleteNote.mutate(item.id)} />
          )}
        />
      </QueryState>

      {os === 'android' ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Add note"
          onPress={openCreate}
          style={({ pressed }) => [styles.fab, pressed && styles.addButtonPressed]}
        >
          <Ionicons name="add" size={20} color={colors.primaryButton.text} />
          <AppText variant="ui.button" tone="inverse" style={styles.fabLabel}>
            Add note
          </AppText>
        </Pressable>
      ) : null}

      <NoteComposer
        visible={composer !== null}
        mode={composer?.mode ?? 'create'}
        initialBody={composer?.mode === 'edit' ? composer.note.body : ''}
        positionSeconds={composer?.mode === 'edit' ? composer.note.position_seconds : (composer?.positionSeconds ?? 0)}
        isSaving={activeMutation.isPending}
        saveError={activeMutation.error}
        onSave={handleSave}
        onCancel={closeComposer}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  drawer: {
    flex: 1,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  tabRowAndroid: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border.default,
    paddingBottom: spacing.sm,
    marginBottom: spacing.xs,
  },
  tabLabelAndroid: {
    letterSpacing: 0.5,
    borderBottomWidth: 2,
    borderBottomColor: colors.accent.gold,
    alignSelf: 'flex-start',
    paddingBottom: spacing.xs,
  },
  tabRowIos: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  segmentPill: {
    backgroundColor: colors.chip.circle,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  iosAddButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  addButtonPressed: {
    opacity: 0.7,
  },
  list: {
    flex: 1,
  },
  listContent: {
    paddingBottom: spacing.xxl * 2,
  },
  fab: {
    position: 'absolute',
    right: spacing.lg,
    bottom: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.primaryButton.bg,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    elevation: 4,
  },
  fabLabel: {
    marginLeft: 2,
  },
});
