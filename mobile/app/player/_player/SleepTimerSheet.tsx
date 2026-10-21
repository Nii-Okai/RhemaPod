import React from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { AppText, Card } from '../../../components';
import { createThemedStyles } from '../../../theme/ThemeContext';
import { spacing } from '../../../theme/spacing';

const OPTIONS_MINUTES = [15, 30, 45, 60] as const;

export interface SleepTimerSheetProps {
  visible: boolean;
  /** Whether a countdown is currently armed — governs whether "Off" is offered. */
  hasActiveTimer: boolean;
  onSelect: (minutes: number | null) => void;
  onClose: () => void;
}

/**
 * Sleep-timer duration picker (design spec §3 Player: "sleep timer"). A plain bottom
 * sheet, not a new shared primitive — this is the sheet's only confirmed use today.
 */
export function SleepTimerSheet({ visible, hasActiveTimer, onSelect, onClose }: SleepTimerSheetProps) {
  const styles = useStyles();
  const choose = (minutes: number | null) => {
    onSelect(minutes);
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.root}>
        <Pressable
          style={StyleSheet.absoluteFillObject}
          accessibilityRole="button"
          accessibilityLabel="Close"
          onPress={onClose}
        >
          <View style={styles.scrim} />
        </Pressable>
        <View style={styles.sheetWrap}>
          <Card style={styles.sheet}>
            <AppText variant="ui.label" tone="tertiary" style={styles.heading}>
              Sleep timer
            </AppText>
            {OPTIONS_MINUTES.map((minutes) => (
              <Pressable
                key={minutes}
                accessibilityRole="button"
                accessibilityLabel={`${minutes} minutes`}
                onPress={() => choose(minutes)}
                style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
              >
                <AppText variant="ui.bodyLarge">{minutes} minutes</AppText>
              </Pressable>
            ))}
            {hasActiveTimer ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Turn off sleep timer"
                onPress={() => choose(null)}
                style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
              >
                <AppText variant="ui.bodyLarge" tone="secondary">
                  Off
                </AppText>
              </Pressable>
            ) : null}
          </Card>
        </View>
      </View>
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
  sheetWrap: {
    padding: spacing.md,
  },
  sheet: {
    gap: spacing.xs,
  },
  heading: {
    textTransform: 'uppercase',
    marginBottom: spacing.xs,
  },
  row: {
    paddingVertical: spacing.md,
  },
  rowPressed: {
    opacity: 0.7,
  },
}));
