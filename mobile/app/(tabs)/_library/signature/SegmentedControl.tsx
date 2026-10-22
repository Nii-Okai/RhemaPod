import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { AppText } from '../../../../components';
import { createThemedStyles } from '../../../../theme/ThemeContext';
import { radius } from '../../../../theme/radius';
import { spacing } from '../../../../theme/spacing';

export interface Segment<K extends string> {
  key: K;
  label: string;
  /** Shown after the label in mono, e.g. a count. */
  meta?: string;
}

export interface SegmentedControlProps<K extends string> {
  segments: Segment<K>[];
  value: K;
  onChange: (key: K) => void;
  accessibilityLabel: string;
}

/**
 * Signature's segmented track, from the You screen's Appearance picker: a sunken track
 * with the selected segment raised out of it. Used for the Library filter and the
 * add-to-playlist sheet's tabs.
 */
export function SegmentedControl<K extends string>({ segments, value, onChange, accessibilityLabel }: SegmentedControlProps<K>) {
  const styles = useStyles();
  return (
    <View style={styles.track} accessibilityRole="radiogroup" accessibilityLabel={accessibilityLabel}>
      {segments.map((segment) => {
        const selected = segment.key === value;
        return (
          <Pressable
            key={segment.key}
            onPress={() => onChange(segment.key)}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            accessibilityLabel={segment.meta ? `${segment.label}, ${segment.meta}` : segment.label}
            style={({ pressed }) => [styles.segment, selected && styles.selected, pressed && !selected && styles.pressed]}
          >
            <AppText variant="ui.button" tone={selected ? 'primary' : 'secondary'} numberOfLines={1}>
              {segment.label}
            </AppText>
            {segment.meta ? (
              <AppText variant="mono.meta" tone={selected ? 'gold' : 'tertiary'}>
                {segment.meta}
              </AppText>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const useStyles = createThemedStyles((colors) => ({
  track: {
    flexDirection: 'row',
    gap: spacing.xs,
    padding: spacing.xs,
    borderRadius: radius.xl,
    backgroundColor: colors.surface.sunken,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border.default,
  },
  segment: {
    flex: 1,
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs + 2,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.lg,
  },
  selected: {
    backgroundColor: colors.surface.raised,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border.card,
  },
  pressed: {
    opacity: 0.7,
  },
}));
