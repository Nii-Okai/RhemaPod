import React, { useState } from 'react';
import { Platform, Pressable, StyleSheet } from 'react-native';
import { AppText, PlatformIcon, Sheet } from '../../../components';
import { useTheme } from '../../../theme/ThemeContext';
import { spacing } from '../../../theme/spacing';

export interface PlaylistOptionsSheetProps {
  visible: boolean;
  onClose: () => void;
  onShare: () => void;
  onAdd: () => void;
  onEditDetails: () => void;
}

/**
 * Playlist detail's "..." menu: the three actions this app can genuinely back: Share (real, React Native's share
 * sheet via `shareContent`), Add to this playlist (opens `AddToPlaylistSheet`),
 * and Name & details (rename/description/privacy/delete). No "Download",
 * "Create cover art", "Switch to video" or "Exclude from taste profile" rows:
 * nothing in this app backs them, and a menu row that does nothing is worse
 * than one that isn't there (the same call
 * `ActionButton`'s own Set Reminders/Rate precedent makes). Cover art has
 * its own entry point already — tapping the cover itself, not this menu.
 */
export function PlaylistOptionsSheet({ visible, onClose, onShare, onAdd, onEditDetails }: PlaylistOptionsSheetProps) {
  const { colors } = useTheme();
  // Closing this sheet and mounting another `<Modal>` in the same tick (React batches
  // `onClose()` + the next sheet's `setXOpen(true)` together) presents two native modals
  // at once and reliably hangs iOS (RN's own Modal can't dismiss and present
  // back-to-back without a gap). "Add to this playlist" and "Name & details" both open
  // another `Sheet`; "Share" opens the OS share sheet, a different native primitive.
  //
  // A fixed delay is not enough — a guessed timeout races the real native dismiss
  // instead of waiting for it. So the action is held until `Sheet`'s own `onDismiss` confirms the native modal
  // has actually finished closing, which only fires on iOS (RN's own `Modal.js`:
  // "OnDismiss is implemented on iOS only") — Android's modal has no equivalent async
  // dismiss to wait for and never exhibited this hang, so it still fires immediately.
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);

  const fire = (action: () => void) => {
    if (Platform.OS === 'ios') {
      setPendingAction(() => action);
      onClose();
    } else {
      onClose();
      action();
    }
  };

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      onDismiss={() => {
        if (!pendingAction) return;
        const run = pendingAction;
        setPendingAction(null);
        run();
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Share"
        onPress={() => fire(onShare)}
        style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      >
        <PlatformIcon name="share-outline" size={20} color={colors.text.primary} />
        <AppText variant="ui.bodyLarge">Share</AppText>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Add to this playlist"
        onPress={() => fire(onAdd)}
        style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      >
        <PlatformIcon name="add" size={20} color={colors.text.primary} />
        <AppText variant="ui.bodyLarge">Add to this playlist</AppText>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Name & details"
        onPress={() => fire(onEditDetails)}
        style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      >
        <PlatformIcon name="pencil" size={20} color={colors.text.primary} />
        <AppText variant="ui.bodyLarge">Name & details</AppText>
      </Pressable>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
  },
  rowPressed: {
    opacity: 0.7,
  },
});
