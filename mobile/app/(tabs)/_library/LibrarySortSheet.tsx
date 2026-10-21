import React from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { AppText, PlatformIcon, Sheet } from '../../../components';
import { useTheme } from '../../../theme/ThemeContext';
import { spacing } from '../../../theme/spacing';
import type { LibrarySortMode } from './librarySort';

export interface LibrarySortSheetProps {
  visible: boolean;
  onClose: () => void;
  value: LibrarySortMode;
  onChange: (mode: LibrarySortMode) => void;
}

const OPTIONS: { mode: LibrarySortMode; label: string }[] = [
  { mode: 'recents', label: 'Recents' },
  { mode: 'recently_added', label: 'Recently added' },
  { mode: 'alphabetical', label: 'Alphabetical' },
  { mode: 'creator', label: 'Creator' },
];

/** "Sort by" (Isaac's screenshots). Four options, same labels as the
 * reference — see `librarySort.ts`'s own doc comment for what each one
 * actually means for a playlist vs. a download, since the two content
 * types don't share the same fields. */
export function LibrarySortSheet({ visible, onClose, value, onChange }: LibrarySortSheetProps) {
  const { colors } = useTheme();
  return (
    <Sheet visible={visible} onClose={onClose}>
      <AppText variant="ui.label" tone="tertiary" accessibilityRole="header" style={styles.heading}>
        Sort by
      </AppText>
      {OPTIONS.map((option) => {
        const selected = option.mode === value;
        return (
          <Pressable
            key={option.mode}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            accessibilityLabel={option.label}
            onPress={() => {
              onChange(option.mode);
              onClose();
            }}
            style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
          >
            <AppText variant="ui.bodyLarge" tone={selected ? 'gold' : 'primary'}>
              {option.label}
            </AppText>
            {selected ? <PlatformIcon name="checkmark" size={20} color={colors.accent.gold} /> : null}
          </Pressable>
        );
      })}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  heading: {
    textTransform: 'uppercase',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
  },
  rowPressed: {
    opacity: 0.7,
  },
});
