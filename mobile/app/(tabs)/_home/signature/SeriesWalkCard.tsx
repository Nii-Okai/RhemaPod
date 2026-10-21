import React from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import { AppText, PlatformIcon, PressableScale } from '../../../../components';
import { createThemedStyles, useTheme } from '../../../../theme/ThemeContext';
import { radius } from '../../../../theme/radius';
import { spacing } from '../../../../theme/spacing';
import { Flame, GlowingFlame } from './Flame';
import { LEAF_SM } from './leaf';
import type { SeriesWalk, WalkStep } from './seriesWalk';

export interface SeriesWalkCardProps {
  walk: SeriesWalk;
  thumbnailUrl: string | null | undefined;
  onOpenSeries: () => void;
  onResume: () => void;
}

function partLabel(walk: SeriesWalk): string {
  const n = walk.current.episode_number;
  return n !== null ? `Continue: Part ${n}` : `Continue: ${walk.current.title}`;
}

/**
 * "Your walk", the top of Home's Series section: the series in progress, where to pick it
 * up, and a row of flames — filled for each finished episode, breathing on the current
 * one. The card opens the series; the play button opens the episode to resume.
 */
export function SeriesWalkCard({ walk, thumbnailUrl, onOpenSeries, onResume }: SeriesWalkCardProps) {
  const styles = useStyles();
  const { colors } = useTheme();
  const meta = [`${walk.position} OF ${walk.total}`, walk.remaining ? `${walk.remaining} LEFT` : null]
    .filter(Boolean)
    .join(' · ');
  const flameSummary = `${walk.doneCount} of ${walk.total} parts finished, part ${walk.position} in progress`;

  const flame = (step: WalkStep) => {
    if (step.state === 'current') return <GlowingFlame width={24} fill="transparent" stroke={colors.accent.gold} />;
    if (step.state === 'done') return <Flame width={24} fill={colors.accent.gold} stroke={colors.accent.gold} />;
    return <Flame width={24} fill="transparent" stroke={colors.border.card} />;
  };

  return (
    <Pressable
      onPress={onOpenSeries}
      accessibilityRole="button"
      accessibilityLabel={`${walk.seriesTitle}. ${partLabel(walk)}. ${flameSummary}`}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <View style={styles.top}>
        <View style={styles.thumb}>
          {thumbnailUrl ? (
            <Image source={{ uri: thumbnailUrl }} style={StyleSheet.absoluteFill} resizeMode="cover" />
          ) : null}
        </View>
        <View style={styles.text}>
          <AppText variant="ui.bodyLarge" numberOfLines={2}>
            {walk.seriesTitle}
          </AppText>
          <AppText variant="ui.body" tone="secondary" numberOfLines={1}>
            {partLabel(walk)}
          </AppText>
          <AppText variant="mono.meta" tone="tertiary">
            {meta}
          </AppText>
        </View>
        <PressableScale
          onPress={onResume}
          accessibilityRole="button"
          accessibilityLabel={`Resume ${walk.current.title}`}
          style={styles.play}
        >
          <PlatformIcon name="play" size={18} color={colors.primaryButton.text} />
        </PressableScale>
      </View>
      <View style={styles.flames} accessible={false} importantForAccessibility="no-hide-descendants">
        {walk.steps.map((step) => (
          <View key={step.id} style={styles.step}>
            {flame(step)}
            <AppText variant="mono.meta" tone={step.state === 'ahead' ? 'tertiary' : 'gold'}>
              {step.label}
            </AppText>
          </View>
        ))}
      </View>
    </Pressable>
  );
}

const useStyles = createThemedStyles((colors) => ({
  card: {
    ...LEAF_SM,
    padding: spacing.lg,
    gap: spacing.lg,
    backgroundColor: colors.surface.raised,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border.default,
  },
  pressed: {
    opacity: 0.85,
  },
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  thumb: {
    ...LEAF_SM,
    width: 72,
    height: 72,
    overflow: 'hidden',
    backgroundColor: colors.surface.sunken,
  },
  text: {
    flex: 1,
    gap: spacing.xs,
  },
  play: {
    width: 48,
    height: 48,
    borderRadius: radius.pill,
    backgroundColor: colors.primaryButton.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  flames: {
    flexDirection: 'row',
    alignItems: 'flex-end',
  },
  step: {
    flex: 1,
    alignItems: 'center',
    gap: spacing.xs,
  },
}));
