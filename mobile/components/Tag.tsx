import React from 'react';
import { StyleSheet, View } from 'react-native';
import { colors } from '../theme/colors';
import { radius } from '../theme/radius';
import { spacing } from '../theme/spacing';
import { AppText } from './Text';

export interface TagProps {
  label: string;
}

/**
 * Inert pill chip (design spec §8.1.9/§8.6) — `track.default` fill, `ui.badge` text,
 * `radius.pill`. Not tappable: no `onPress`, no `accessibilityRole="button"` — a tag is a
 * label, not a filter/related-content affordance (none exists in scope, L5). Per §8.7,
 * left without an explicit `accessibilityRole` so VoiceOver/TalkBack reads it as plain
 * text rather than announcing a tap affordance that isn't there.
 *
 * One confirmed MVP use today (sermon-detail tags row). Promote further only if a second
 * concrete use shows up — same bar the spec already applies to the wheat-notice component
 * (§1.1/§5 item 10).
 */
export function Tag({ label }: TagProps) {
  return (
    <View style={styles.chip}>
      <AppText variant="ui.badge" tone="secondary">
        {label}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    backgroundColor: colors.track.default,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
});
