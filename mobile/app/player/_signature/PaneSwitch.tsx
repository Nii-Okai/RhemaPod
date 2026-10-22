import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { AppText, PlatformIcon, type AppIconName } from '../../../components';
import { createThemedStyles, useTheme } from '../../../theme/ThemeContext';
import { spacing } from '../../../theme/spacing';

export type PlayerPane = 'queue' | 'comments';

export interface PaneSwitchProps {
  pane: PlayerPane;
  onSelectPane: (pane: PlayerPane) => void;
  bottomInset: number;
}

/**
 * Queue / Comments switch at the foot of the Signature player, shown only when it was
 * opened from a playlist — the one case with two panels to choose between. The queue is
 * still what opens first (Isaac's 2026-10-11 ask). Playback controls stay on the video.
 */
export function PaneSwitch({ pane, onSelectPane, bottomInset }: PaneSwitchProps) {
  const styles = useStyles();
  return (
    <View style={[styles.bar, { paddingBottom: spacing.sm + bottomInset }]} accessibilityRole="tablist">
      <Tab icon="list" label="Queue" accessibilityLabel="Show queue" active={pane === 'queue'} onPress={() => onSelectPane('queue')} />
      <Tab
        icon="chatbubble-outline"
        label="Comments"
        accessibilityLabel="Show comments"
        active={pane === 'comments'}
        onPress={() => onSelectPane('comments')}
      />
    </View>
  );
}

interface TabProps {
  icon: AppIconName;
  label: string;
  accessibilityLabel: string;
  active: boolean;
  onPress: () => void;
}

function Tab({ icon, label, accessibilityLabel, active, onPress }: TabProps) {
  const styles = useStyles();
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ pressed }) => [styles.tab, pressed && styles.pressed]}
    >
      <PlatformIcon name={icon} size={22} color={active ? colors.accent.goldText : colors.text.secondary} />
      <AppText variant="ui.badge" tone={active ? 'gold' : 'secondary'} numberOfLines={1}>
        {label}
      </AppText>
    </Pressable>
  );
}

const useStyles = createThemedStyles((colors) => ({
  bar: {
    flexDirection: 'row',
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.xs,
    marginTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border.default,
    backgroundColor: colors.surface.app,
  },
  tab: {
    flex: 1,
    minHeight: 56,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  pressed: {
    opacity: 0.7,
  },
}));
