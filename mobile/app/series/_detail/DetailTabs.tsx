import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { AppText } from '../../../components';
import { colors } from '../../../theme/colors';
import { spacing } from '../../../theme/spacing';
import { scaledLineHeight } from '../../../theme/typography';

export type DetailTab = 'episodes' | 'related';

const TAB_FONT_SIZE = 18;

export interface DetailTabsProps {
  active: DetailTab;
  onChange: (tab: DetailTab) => void;
}

const TABS: { key: DetailTab; label: string }[] = [
  { key: 'episodes', label: 'Episodes' },
  { key: 'related', label: 'Related' },
];

/**
 * Episodes/Related tab switcher (Isaac's ask, session 2026-09-30) — just these two.
 * Netflix's own reference also has "Collection" and "Trailers" tabs, but this app has
 * no data for either (no trailer renditions, no series-collection concept) — a tab
 * that opens onto nothing is worse than no tab, same call this screen's original build
 * already made for those two.
 */
export function DetailTabs({ active, onChange }: DetailTabsProps) {
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
            <AppText variant="ui.label" tone={selected ? 'primary' : 'tertiary'} style={styles.label}>
              {tab.label}
            </AppText>
            {selected ? <View style={styles.underline} /> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: spacing.lg,
    paddingHorizontal: spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border.default,
  },
  tab: {
    paddingVertical: spacing.sm,
    alignItems: 'center',
    gap: spacing.xs,
  },
  label: {
    fontSize: TAB_FONT_SIZE,
    lineHeight: scaledLineHeight(TAB_FONT_SIZE, 1.2),
  },
  underline: {
    height: 2,
    width: '100%',
    backgroundColor: colors.accent.gold,
    borderRadius: 1,
  },
});
