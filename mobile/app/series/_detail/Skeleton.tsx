import React from 'react';
import { StyleSheet, View } from 'react-native';
import { SkeletonBlock } from '../../../components';
import { spacing } from '../../../theme/spacing';

/**
 * Static, non-animated loading placeholder for series detail, mirroring sermon-detail's
 * own `DetailSkeleton` (design spec §1.4's "no shimmer/motion" restraint) — sized to
 * this screen's actual regions: 16:9 hero, title, one meta bar, a pill CTA placeholder,
 * a small action-row placeholder, three synopsis lines, then three episode-row
 * placeholders (thumbnail + two text lines each).
 */
export function SeriesDetailSkeleton() {
  return (
    <View accessibilityRole="progressbar" accessibilityLabel="Loading series" style={styles.screen}>
      {/* Matches the real hero's 4:3 ratio (Isaac's ask, session 2026-09-30: a bigger
          banner) at a representative phone width — not measured live, just a closer
          placeholder than the old 16:9-sized block was. */}
      <SkeletonBlock height={300} radiusToken="sm" />
      <View style={styles.body}>
        <SkeletonBlock height={26} width="70%" />
        <SkeletonBlock height={11} width="45%" />
        <SkeletonBlock height={44} width={140} radiusToken="pill" />
        <SkeletonBlock height={20} width={90} radiusToken="pill" />
        <View style={styles.paragraph}>
          <SkeletonBlock height={14} width="100%" />
          <SkeletonBlock height={14} width="100%" />
          <SkeletonBlock height={14} width="80%" />
        </View>
      </View>
      <View style={styles.episodes}>
        {[0, 1, 2].map((i) => (
          <View key={i} style={styles.episodeRow}>
            <SkeletonBlock height={68} width={120} radiusToken="sm" />
            <View style={styles.episodeText}>
              <SkeletonBlock height={16} width="80%" />
              <SkeletonBlock height={11} width="40%" />
            </View>
          </View>
        ))}
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
  episodes: {
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
  },
  episodeRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  episodeText: {
    flex: 1,
    gap: spacing.sm,
    justifyContent: 'center',
  },
});
