import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { AppText } from '../../../components';
import { createThemedStyles } from '../../../theme/ThemeContext';
import { spacing } from '../../../theme/spacing';
import type { DetailTab } from '../_detail/DetailTabs';

const TABS: { key: DetailTab; label: string }[] = [
  { key: 'episodes', label: 'Episodes' },
  { key: 'related', label: 'Related' },
];

export interface SignatureTabsProps {
  active: DetailTab;
  onChange: (tab: DetailTab) => void;
  /** Right-aligned note on the tab row ("2 of 8 finished"). */
  note?: string | null;
}

/** Episodes / Related, the active one bold with a 3pt ink underline (Daybreak canvas C2). */
export function SignatureTabs({ active, onChange, note }: SignatureTabsProps) {
  const styles = useStyles();
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
            style={[styles.tab, selected && styles.tabOn]}
          >
            <AppText variant="ui.bodyBold" tone={selected ? 'primary' : 'tertiary'}>
              {tab.label}
            </AppText>
          </Pressable>
        );
      })}
      {note ? (
        <AppText variant="ui.badge" tone="tertiary" style={styles.note}>
          {note}
        </AppText>
      ) : null}
    </View>
  );
}

const useStyles = createThemedStyles((colors) => ({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xl,
    marginHorizontal: spacing.lg + 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border.default,
  },
  tab: {
    minHeight: 44,
    paddingVertical: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    borderBottomWidth: 3,
    borderBottomColor: 'transparent',
  },
  tabOn: {
    borderBottomColor: colors.text.primary,
  },
  note: {
    marginLeft: 'auto',
  },
}));
