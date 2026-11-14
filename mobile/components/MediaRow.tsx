import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { createThemedStyles, useTheme } from '../theme/ThemeContext';
import type { SermonLike } from '../lib/playback/queue';
import { useQueueGesture } from '../lib/playback/useQueueGesture';
import { spacing } from '../theme/spacing';
import { FittedArt } from './FittedArt';
import { PlatformIcon } from './PlatformIcon';
import { AppText } from './Text';

export interface MediaRowProps {
  title: string;
  meta?: string | null;
  thumbnailUrl?: string | null;
  /** Drawn in the art slot instead of a thumbnail (a speaker's initials). */
  art?: React.ReactNode;
  /** Part of the title to mark, case-insensitive (Search's query). */
  highlight?: string;
  /** 0 to 1: a thin listening-progress line under the meta. */
  progress?: number | null;
  /** Right-hand slot: a "New" or "Saved" pill, a More button. */
  trailing?: React.ReactNode;
  onPress?: () => void;
  accessibilityLabel?: string;
  /** Draws the hairline under the row (off for the last row of a list). */
  divider?: boolean;
  artSize?: number;
  testID?: string;
  /** A sermon row: a long press offers Play next / Add to queue. */
  queueSermon?: SermonLike | null;
}

/**
 * Daybreak's list row (canvas B4/B6/C2/E2): a rounded square of art, the title in bold,
 * a quiet meta line, and an optional pill or button on the right.
 */
export function MediaRow({
  title,
  meta,
  thumbnailUrl,
  art,
  highlight,
  progress,
  trailing,
  onPress,
  accessibilityLabel,
  divider = true,
  artSize = 56,
  testID,
  queueSermon,
}: MediaRowProps) {
  const styles = useStyles();
  const { colors } = useTheme();
  const queueGesture = useQueueGesture(queueSermon);
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      {...queueGesture}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={accessibilityLabel ?? (meta ? `${title}, ${meta}` : title)}
      style={({ pressed }) => [styles.row, divider && styles.divider, pressed && styles.pressed]}
    >
      <View style={[styles.art, { width: artSize, height: artSize, borderRadius: artSize / 4 }]}>
        {art ?? (thumbnailUrl ? <FittedArt uri={thumbnailUrl} /> : <PlatformIcon name="musical-notes-outline" size={20} color={colors.text.tertiary} />)}
      </View>
      <View style={styles.text}>
        <AppText variant="ui.bodyBold" numberOfLines={2}>
          {highlight ? <Highlighted text={title} query={highlight} /> : title}
        </AppText>
        {meta ? (
          <AppText variant="ui.badge" tone="tertiary" numberOfLines={1}>
            {meta}
          </AppText>
        ) : null}
        {progress != null && progress > 0 ? (
          <View style={styles.track}>
            <View style={[styles.fill, { width: `${Math.min(1, progress) * 100}%` }]} />
          </View>
        ) : null}
      </View>
      {trailing ? <View style={styles.trailing}>{trailing}</View> : null}
    </Pressable>
  );
}

function Highlighted({ text, query }: { text: string; query: string }) {
  const styles = useStyles();
  const q = query.trim().toLowerCase();
  const at = q ? text.toLowerCase().indexOf(q) : -1;
  if (at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <AppText variant="ui.bodyBold" style={styles.mark}>
        {text.slice(at, at + q.length)}
      </AppText>
      {text.slice(at + q.length)}
    </>
  );
}

/** A small uppercase pill: "New" (gold), "Saved" (green), "Series" (blue). */
export function RowPill({ label, tone }: { label: string; tone: 'sun' | 'sage' | 'iris' }) {
  const styles = useStyles();
  return (
    <View style={[styles.pill, styles[`pill_${tone}`]]}>
      <AppText variant="ui.badge" style={styles[`pillText_${tone}`]}>
        {label.toUpperCase()}
      </AppText>
    </View>
  );
}

const useStyles = createThemedStyles((colors) => ({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md + 2,
    paddingVertical: spacing.sm,
    minHeight: 72,
  },
  divider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border.default,
  },
  pressed: {
    opacity: 0.7,
  },
  art: {
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface.sunken,
  },
  text: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  mark: {
    backgroundColor: colors.verse.bg,
  },
  track: {
    width: 120,
    height: 4,
    borderRadius: 2,
    overflow: 'hidden',
    backgroundColor: colors.track.default,
  },
  fill: {
    height: 4,
    backgroundColor: colors.accent.gold,
  },
  trailing: {
    flexShrink: 0,
  },
  pill: {
    height: 24,
    paddingHorizontal: spacing.sm + 2,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-start',
  },
  pill_sun: { backgroundColor: colors.sunButton.bg },
  pill_sage: { backgroundColor: colors.status.sage.bg },
  pill_iris: { backgroundColor: colors.iris.soft },
  pillText_sun: { color: colors.sunButton.text, letterSpacing: 0.6 },
  pillText_sage: { color: colors.status.sage.text, letterSpacing: 0.6 },
  pillText_iris: { color: colors.iris.ink, letterSpacing: 0.6 },
}));
