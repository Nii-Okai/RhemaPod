import React from 'react';
import { StyleSheet, View } from 'react-native';
import { SkeletonBlock } from '../../../components';
import { spacing } from '../../../theme/spacing';

/**
 * Static, non-animated loading placeholder (design spec §8.4) — sized to each region's
 * real footprint: 16:9 hero block, two title bars (~70%/45% width), one meta bar, a
 * pill-shaped CTA placeholder, three synopsis lines, three small pill tag placeholders.
 * No shimmer/motion, per §1.4's own stated restraint.
 */
export function DetailSkeleton() {
  return (
    <View accessibilityRole="progressbar" accessibilityLabel="Loading sermon" style={styles.screen}>
      <SkeletonBlock height={240} radiusToken="sm" />
      <View style={styles.body}>
        <SkeletonBlock height={26} width="70%" />
        <SkeletonBlock height={26} width="45%" />
        <SkeletonBlock height={11} width="60%" />
        <SkeletonBlock height={44} width={140} radiusToken="pill" />
        <View style={styles.paragraph}>
          <SkeletonBlock height={14} width="100%" />
          <SkeletonBlock height={14} width="100%" />
          <SkeletonBlock height={14} width="80%" />
        </View>
        <View style={styles.tags}>
          <SkeletonBlock height={24} width={64} radiusToken="pill" />
          <SkeletonBlock height={24} width={80} radiusToken="pill" />
          <SkeletonBlock height={24} width={56} radiusToken="pill" />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    gap: spacing.md,
  },
  body: {
    gap: spacing.md,
    padding: spacing.lg,
  },
  paragraph: {
    gap: spacing.sm,
  },
  tags: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
});
