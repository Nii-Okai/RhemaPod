import React from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { createThemedStyles } from '../theme/ThemeContext';
import { radius } from '../theme/radius';
import { spacing } from '../theme/spacing';

export interface SheetProps {
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
  /** Fires once this sheet's native `Modal` has actually finished dismissing — iOS
   * only (RN's own `Modal.js`: "OnDismiss is implemented on iOS only"). A caller that
   * needs to open a SECOND `Modal` right after this one closes (`PlaylistOptionsSheet`,
   * Isaac's ask, session 2026-10-10) needs this, not just `onClose` — two native modals
   * presenting/dismissing in the same tick reliably hangs iOS, and only this event (not
   * a guessed delay) reliably tells you the first one is actually gone. */
  onDismiss?: () => void;
}

/**
 * Bottom-sheet chrome, originally shared by the report, terms and name sheets (design
 * spec §2.4), promoted here from `app/player/_comments/` once the Me page's own avatar
 * picker (session 2026-10-09) became a second, unrelated feature area needing the exact
 * same chrome — same promotion bar `IconButton`/`Toggle`'s own doc comments describe. A
 * slide-up `Modal`, a `surface.app` scrim at 0.6 (the `SleepTimerSheet` precedent, no rgba
 * literal), a `surface.raised` body with `radius.xl` top corners, safe-area bottom padding,
 * and a scroll region so a tall sheet (large text sizes) never clips. Tapping the scrim or
 * the system back closes it.
 */
export function Sheet({ visible, onClose, children, onDismiss }: SheetProps) {
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} onDismiss={onDismiss}>
      <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable
          style={StyleSheet.absoluteFillObject}
          accessibilityRole="button"
          accessibilityLabel="Close"
          onPress={onClose}
        >
          <View style={styles.scrim} />
        </Pressable>
        <View style={[styles.sheet, { paddingBottom: spacing.lg + insets.bottom }]} accessibilityViewIsModal>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.content}
            showsVerticalScrollIndicator={false}
          >
            {children}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const useStyles = createThemedStyles((colors) => ({
  root: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  scrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.surface.app,
    opacity: 0.6,
  },
  sheet: {
    maxHeight: '85%',
    backgroundColor: colors.surface.raised,
    borderColor: colors.border.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingTop: spacing.lg,
    paddingHorizontal: spacing.lg,
  },
  content: {
    gap: spacing.md,
  },
}));
