import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { AppText, PlatformIcon } from '../../../components';
import { EpisodeDownloadButton } from '../../../components/series/EpisodeDownloadButton';
import { createThemedStyles, useTheme } from '../../../theme/ThemeContext';
import { spacing } from '../../../theme/spacing';
import type { SeriesEpisode } from '../../../lib/query/hooks/useSeries';
import type { EpisodeProgress } from './episodeProgress';

export interface SignatureEpisodeRowProps {
  episode: SeriesEpisode;
  progress: EpisodeProgress;
  /** The episode Resume would open: its node glows gold and its text sits in a card. */
  current: boolean;
  /** Draws the line down to the next episode's node. */
  last?: boolean;
  /** Shown in the node when the episode has no number of its own. */
  position: number;
  onPress: () => void;
}

const NODE = 32;

/**
 * One episode on the series page as a step on a path (Daybreak canvas C2): a round node
 * (green tick when finished, gold with its number for the one you're on, sand for the
 * rest) joined to the next by a line, the title and length beside it, and the same
 * per-episode download button the classic row uses (a sibling of the row's own press
 * target, so downloading never also opens the episode).
 */
export function SignatureEpisodeRow({ episode, progress, current, last = false, position, onPress }: SignatureEpisodeRowProps) {
  const styles = useStyles();
  const { colors } = useTheme();
  const number = episode.episode_number ?? position;
  const label = [`Episode ${number}`, episode.title, progress.meta.toLowerCase()].filter(Boolean).join(', ');
  const done = progress.state === 'done';

  return (
    <View style={styles.row}>
      <View style={styles.rail}>
        <View style={[styles.node, done ? styles.nodeDone : current ? styles.nodeCurrent : styles.nodeAhead]}>
          {done ? (
            <PlatformIcon name="checkmark" size={16} color={colors.status.sage.bg} />
          ) : (
            <AppText variant="ui.label" style={current ? styles.nodeTextCurrent : styles.nodeTextAhead}>
              {String(number)}
            </AppText>
          )}
        </View>
        {last ? null : <View style={[styles.line, done && styles.lineDone]} />}
      </View>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={label}
        style={({ pressed }) => [styles.pressable, current && styles.card, pressed && styles.pressed]}
      >
        <AppText variant="ui.bodyBold" tone={done ? 'tertiary' : 'primary'} numberOfLines={2}>
          {`${number} · ${episode.title}`}
        </AppText>
        {current && progress.fraction > 0 ? (
          <View style={styles.progressRow}>
            <View style={styles.track}>
              <View testID={`episode-progress-${episode.id}`} style={[styles.fill, { width: `${progress.fraction * 100}%` }]} />
            </View>
          </View>
        ) : null}
        {progress.meta ? (
          <AppText variant="ui.badge" tone="tertiary">
            {progress.meta}
          </AppText>
        ) : null}
        {!current && progress.state === 'started' && progress.fraction > 0 ? (
          <View style={styles.track}>
            <View testID={`episode-progress-${episode.id}`} style={[styles.fill, { width: `${progress.fraction * 100}%` }]} />
          </View>
        ) : null}
      </Pressable>
      <View style={styles.download}>
        <EpisodeDownloadButton
          episodeId={episode.id}
          episodeTitle={episode.title}
          mediaType={episode.media_type ?? null}
          thumbnailUrl={episode.thumbnail_url}
          category={episode.category_name}
        />
      </View>
    </View>
  );
}

const useStyles = createThemedStyles((colors) => ({
  row: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: spacing.md + 2,
  },
  rail: {
    width: NODE,
    alignItems: 'center',
  },
  node: {
    width: NODE,
    height: NODE,
    borderRadius: NODE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nodeDone: {
    backgroundColor: colors.status.sage.text,
  },
  nodeCurrent: {
    backgroundColor: colors.sunButton.bg,
    borderWidth: 4,
    borderColor: colors.verse.bg,
  },
  nodeAhead: {
    backgroundColor: colors.surface.sunken,
  },
  nodeTextCurrent: {
    color: colors.sunButton.text,
  },
  nodeTextAhead: {
    color: colors.text.secondary,
  },
  line: {
    flex: 1,
    width: 2,
    minHeight: spacing.lg,
    backgroundColor: colors.border.default,
  },
  lineDone: {
    backgroundColor: colors.status.sage.text,
  },
  pressable: {
    flex: 1,
    gap: 4,
    paddingTop: 4,
    paddingBottom: spacing.lg + 2,
  },
  card: {
    marginTop: -6,
    marginBottom: spacing.lg,
    padding: spacing.md + 2,
    gap: spacing.sm,
    borderRadius: 24,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border.default,
    backgroundColor: colors.surface.raised,
  },
  pressed: {
    opacity: 0.7,
  },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  track: {
    flex: 1,
    height: 4,
    borderRadius: 2,
    overflow: 'hidden',
    backgroundColor: colors.track.default,
  },
  fill: {
    height: 4,
    backgroundColor: colors.accent.gold,
  },
  download: {
    paddingTop: 0,
  },
}));
