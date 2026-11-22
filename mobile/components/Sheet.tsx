import React from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaProvider, initialWindowMetrics, useSafeAreaInsets } from 'react-native-safe-area-context';
import { createThemedStyles } from '../theme/ThemeContext';
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
  /** Pinned below the scroll region, never scrolled away: the controls a sheet must
   * always show (the terms sheet's agree checkbox and buttons). Without it, a sheet whose
   * body is taller than the screen hides its actions at the bottom of the scroll. */
  footer?: React.ReactNode;
}

// Fallback metrics so the in-modal provider renders its children on the first frame
// (and in tests, where there is no native window); the native side then reports the
// modal window's real insets.
const ZERO_METRICS = {
  frame: { x: 0, y: 0, width: 0, height: 0 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

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
export function Sheet({ visible, onClose, children, onDismiss, footer }: SheetProps) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      onDismiss={onDismiss}
      statusBarTranslucent
    >
      {/* A react-native `Modal` is its own native window on Android, so the app root's
          safe-area insets don't describe it: on Android it can draw under the navigation
          bar while the root reports a bottom inset of 0, which hid the bottom of tall
          sheets (the comment guidelines' agree control) behind the nav bar. A provider
          inside the modal measures the modal's own window. */}
      <SafeAreaProvider initialMetrics={initialWindowMetrics ?? ZERO_METRICS}>
        <SheetBody onClose={onClose} footer={footer}>
          {children}
        </SheetBody>
      </SafeAreaProvider>
    </Modal>
  );
}

function SheetBody({ onClose, children, footer }: Pick<SheetProps, 'onClose' | 'children' | 'footer'>) {
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Pressable
        style={StyleSheet.absoluteFillObject}
        accessibilityRole="button"
        accessibilityLabel="Close"
        onPress={onClose}
      >
        <View style={styles.scrim} />
      </Pressable>
      <View
        style={[styles.sheet, { marginTop: insets.top + spacing.lg, paddingBottom: spacing.lg + insets.bottom }]}
        accessibilityViewIsModal
      >
        <View style={styles.grab} />
        <ScrollView
          style={styles.scroll}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={footer != null}
        >
          {children}
        </ScrollView>
        {footer != null ? <View style={styles.footer}>{footer}</View> : null}
      </View>
    </KeyboardAvoidingView>
  );
}

const useStyles = createThemedStyles((colors) => ({
  root: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  // Daybreak (canvas C6/C7): a navy dim in both themes, then a paper sheet with 32pt
  // corners and a grab handle.
  scrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.overlay.chipFill,
  },
  sheet: {
    maxHeight: '85%',
    backgroundColor: colors.surface.app,
    borderColor: colors.border.default,
    borderWidth: StyleSheet.hairlineWidth,
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    paddingTop: spacing.sm + 2,
    paddingHorizontal: spacing.lg + 4,
  },
  grab: {
    alignSelf: 'center',
    width: 40,
    height: 5,
    borderRadius: 3,
    marginBottom: spacing.md,
    backgroundColor: colors.border.card,
  },
  // Shrinks to fit so a tall body scrolls inside the sheet instead of pushing the sheet
  // (and anything below it) off screen.
  scroll: {
    flexGrow: 0,
    flexShrink: 1,
  },
  content: {
    gap: spacing.md,
  },
  footer: {
    gap: spacing.md,
    paddingTop: spacing.md,
  },
}));
