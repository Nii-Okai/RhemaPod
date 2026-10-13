import React from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { AppText } from './Text';
import { LinkButton } from './Button';
import { colors } from '../theme/colors';
import { radius } from '../theme/radius';
import { spacing } from '../theme/spacing';

export interface ConfirmDialogProps {
  visible: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Centred confirm card (design spec §2.3 / §2.5) used by both Delete and Block. The
 * destructive action is a rose text action rather than a filled button — this app has no
 * destructive-button token and the spec deliberately avoids a fourth button style.
 */
export function ConfirmDialog({ visible, title, body, confirmLabel, onConfirm, onCancel }: ConfirmDialogProps) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.root}>
        <Pressable
          style={StyleSheet.absoluteFillObject}
          accessibilityRole="button"
          accessibilityLabel="Close"
          onPress={onCancel}
        >
          <View style={styles.scrim} />
        </Pressable>
        <View style={styles.card} accessibilityViewIsModal>
          <AppText variant="display.compact" accessibilityRole="header">
            {title}
          </AppText>
          <AppText variant="ui.body" tone="secondary">
            {body}
          </AppText>
          <View style={styles.actions}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={confirmLabel}
              onPress={onConfirm}
              style={({ pressed }) => [styles.confirm, pressed && styles.pressed]}
            >
              <AppText variant="ui.button" style={styles.confirmText}>
                {confirmLabel}
              </AppText>
            </Pressable>
            <LinkButton label="Cancel" onPress={onCancel} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  scrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.surface.app,
    opacity: 0.6,
  },
  card: {
    width: '100%',
    maxWidth: 400,
    gap: spacing.md,
    padding: spacing.xl,
    backgroundColor: colors.surface.raised,
    borderColor: colors.border.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.lg,
  },
  actions: {
    gap: spacing.md,
    alignItems: 'flex-start',
  },
  confirm: {
    minHeight: 52,
    justifyContent: 'center',
  },
  confirmText: {
    color: colors.status.rose.text,
  },
  pressed: {
    opacity: 0.7,
  },
});
