import React, { useState } from 'react';
import { Platform, Pressable, StyleSheet } from 'react-native';
import { AppText, PlatformIcon, Sheet } from '../../../components';
import { colors } from '../../../theme/colors';
import { spacing } from '../../../theme/spacing';

export interface PlaylistOptionsSheetProps {
  visible: boolean;
  onClose: () => void;
  onShare: () => void;
  onAdd: () => void;
  onEditDetails: () => void;
}

/**
 * Playlist detail's "..." menu (Isaac's screenshots). Trimmed to the three
 * actions this app can genuinely back: Share (real, React Native's share
 * sheet via `shareContent`), Add to this playlist (opens `AddToPlaylistSheet`),
 * and Name & details (rename/description/privacy/delete). The reference
 * sheet's "Download", "Create cover art", "Switch to video", and "Exclude
 * playlist from taste profile" rows are left out — no bulk-download-a-
 * playlist pipeline, no cover-art generator, no audio/video switch, and no
 * recommendation algorithm exist anywhere in this app to back them; a menu
 * row that does nothing is worse than one that isn't there (the same call
 * `ActionButton`'s own Set Reminders/Rate precedent makes). Cover art has
 * its own entry point already — tapping the cover itself, not this menu.
 */
export function PlaylistOptionsSheet({ visible, onClose, onShare, onAdd, onEditDetails }: PlaylistOptionsSheetProps) {
  // Closing this sheet and mounting another `<Modal>` in the same tick (React 18
  // batches `onClose()` + the next sheet's `setXOpen(true)` together) presents two
  // native modals at once and reliably hangs iOS (RN's own Modal can't dismiss and
  // present back-to-back without a gap). Isaac's report, session 2026-10-10: tapping
  // "Add to this playlist" or "Name & details" from this menu froze the screen — both
  // open another `Sheet`; "Share" never did, since it opens the OS share sheet, a
  // different native primitive, not an RN Modal.
  //
  // A fixed delay before firing the next action was tried first and *didn't* reliably
  // fix it (Isaac's follow-up, same session: "options-menu freeze is not fixed") — a
  // guessed timeout races the real native dismiss instead of waiting for it. This
  // version holds the action until `Sheet`'s own `onDismiss` confirms the native modal
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
