import React, { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { AppText, Card, LinkButton, PrimaryButton } from '../../../components';
import { colors } from '../../../theme/colors';
import { radius } from '../../../theme/radius';
import { spacing } from '../../../theme/spacing';
import { formatDuration } from '../../../lib/format/duration';
import { ApiError } from '../../../lib/api/errors';

export interface NoteComposerProps {
  visible: boolean;
  mode: 'create' | 'edit';
  initialBody: string;
  /** The timestamp the note is (or was) taken at — shown read-only; a note's position is
   * fixed at creation, only its text is editable here (`useUpdateNote` supports patching
   * `position_seconds` too, but no call site needs that yet — not wiring an unused knob). */
  positionSeconds: number;
  isSaving: boolean;
  saveError: unknown;
  onSave: (body: string) => void;
  onCancel: () => void;
}

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return "Couldn't save this note. Try again.";
}

/**
 * Create/edit sheet for a single note (design spec §3 Player: "so playback never has to
 * stop to take a note" — this renders as a modal over the still-playing video, not a
 * screen transition). One component serves both the "+ Note" / extended-FAB create flow
 * and tapping an existing `NoteListItem` to edit — same fields, different seed value and
 * mutation the caller wires up.
 */
export function NoteComposer({
  visible,
  mode,
  initialBody,
  positionSeconds,
  isSaving,
  saveError,
  onSave,
  onCancel,
}: NoteComposerProps) {
  const [body, setBody] = useState(initialBody);

  // Reseed local text state each time the sheet opens — covers both a fresh "+ Note" (empty)
  // and reopening to edit a different note (the previous sheet's leftover text must not leak in).
  useEffect(() => {
    if (visible) setBody(initialBody);
  }, [visible, initialBody]);

  const trimmed = body.trim();
  const canSave = trimmed.length > 0 && !isSaving;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onCancel}>
      <View style={styles.root}>
        <Pressable
          style={StyleSheet.absoluteFillObject}
          accessibilityRole="button"
          accessibilityLabel="Close"
          onPress={onCancel}
        >
          <View style={styles.scrim} />
        </Pressable>
        <View style={styles.sheetWrap}>
          <Card style={styles.sheet}>
            <View style={styles.headerRow}>
              <AppText variant="ui.label" tone="tertiary" style={styles.heading}>
                {mode === 'create' ? 'New note' : 'Edit note'}
              </AppText>
              <AppText variant="mono.tight" tone="gold">
                {formatDuration(positionSeconds)}
              </AppText>
            </View>
            <TextInput
              value={body}
              onChangeText={setBody}
              placeholder="Add a note…"
              placeholderTextColor={colors.text.tertiary}
              multiline
              autoFocus
              style={styles.input}
              accessibilityLabel="Note text"
            />
            {saveError ? (
              <AppText variant="ui.badge" style={styles.errorText}>
                {errorMessage(saveError)}
              </AppText>
            ) : null}
            <View style={styles.actionsRow}>
              <LinkButton label="Cancel" accessibilityLabel="Cancel" onPress={onCancel} disabled={isSaving} />
              <PrimaryButton
                label="Save"
                accessibilityLabel="Save note"
                loading={isSaving}
                disabled={!canSave}
                onPress={() => onSave(trimmed)}
              />
            </View>
          </Card>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  scrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.surface.app,
    opacity: 0.6,
  },
  sheetWrap: {
    padding: spacing.md,
  },
  sheet: {
    gap: spacing.md,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  heading: {
    textTransform: 'uppercase',
  },
  input: {
    minHeight: 96,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border.default,
    backgroundColor: colors.surface.sunken,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    color: colors.text.primary,
    fontSize: 15,
    textAlignVertical: 'top',
  },
  errorText: {
    color: colors.status.rose.text,
  },
  actionsRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: spacing.lg,
  },
});
