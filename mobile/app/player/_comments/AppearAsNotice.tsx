import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AppText, LinkButton } from '../../../components';
import { colors } from '../../../theme/colors';
import { radius } from '../../../theme/radius';
import { spacing } from '../../../theme/spacing';

export interface AppearAsNoticeProps {
  /** The "First L." the viewer will appear as. */
  displayName: string;
  onChange: () => void;
  onDismiss: () => void;
}

/**
 * The one-time "You'll appear as ..." strip above the composer (plan D6, design spec §2.7).
 * It is shown once per user per device (see `lib/settings/commentsNotice`) and dismissed by
 * the X or automatically after the first successful post. "Change" reopens the name editor.
 */
export function AppearAsNotice({ displayName, onChange, onDismiss }: AppearAsNoticeProps) {
  return (
    <View style={styles.strip}>
      <AppText variant="ui.body" style={styles.text}>
        {`You'll appear as '${displayName}'`}
      </AppText>
      <LinkButton label="Change" onPress={onChange} />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Dismiss"
        onPress={onDismiss}
        hitSlop={spacing.sm}
        style={styles.close}
      >
        <Ionicons name="close" size={18} color={colors.text.secondary} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  strip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.status.slate.bg,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  text: {
    flex: 1,
  },
  close: {
    minWidth: 28,
    minHeight: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
