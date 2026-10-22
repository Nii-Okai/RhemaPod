import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { AppText } from '../../../components';
import { createThemedStyles, useTheme } from '../../../theme/ThemeContext';
import { spacing } from '../../../theme/spacing';
import { Flame } from '../../(tabs)/_home/signature/Flame';
import type { DetailTab } from '../_detail/DetailTabs';

const TABS: { key: DetailTab; label: string }[] = [
  { key: 'episodes', label: 'Episodes' },
  { key: 'related', label: 'Related' },
];

export interface SignatureTabsProps {
  active: DetailTab;
  onChange: (tab: DetailTab) => void;
}

/** Episodes / Related, with Signature's small gold flame under the active tab in place of an underline. */
export function SignatureTabs({ active, onChange }: SignatureTabsProps) {
  const styles = useStyles();
  const { colors } = useTheme();
  return (
    <View style={styles.row} accessibilityRole="tablist">
      {TABS.map((tab) => {
        const selected = tab.key === active;
        return (
          <Pressable
            key={tab.key}
            testID={`detail-tab-${tab.key}`}
            onPress={() => onChange(tab.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            style={styles.tab}
          >
            <AppText variant="ui.button" tone={selected ? 'primary' : 'secondary'}>
              {tab.label}
            </AppText>
            <Flame width={8} fill={selected ? colors.accent.goldText : 'transparent'} />
          </Pressable>
        );
      })}
    </View>
  );
}

const useStyles = createThemedStyles((colors) => ({
  row: {
    flexDirection: 'row',
    gap: spacing.xl,
    paddingHorizontal: spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border.default,
  },
  tab: {
    minHeight: 44,
    paddingTop: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
}));
