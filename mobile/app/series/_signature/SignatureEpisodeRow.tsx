import React from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import { AppText } from '../../../components';
import { EpisodeDownloadButton } from '../../../components/series/EpisodeDownloadButton';
import { createThemedStyles } from '../../../theme/ThemeContext';
import { spacing } from '../../../theme/spacing';
import type { SeriesEpisode } from '../../../lib/query/hooks/useSeries';
import { LEAF_SM } from '../../(tabs)/_home/signature/leaf';
import type { EpisodeProgress } from './episodeProgress';

export interface SignatureEpisodeRowProps {
  episode: SeriesEpisode;
  progress: EpisodeProgress;
  /** The episode Resume would open — its row sits on a raised panel. */
  current: boolean;
  onPress: () => void;
}

const THUMBNAIL_WIDTH = 120;

/**
 * One episode on the Signature series page: leaf-cornered art with a gold bar for how
 * far the viewer got, the title, a mono line with the duration and watch state, and the
 * same per-episode download button the classic row uses (a sibling of the row's own
 * press target, so downloading never also opens the episode).
 */
export function SignatureEpisodeRow({ episode, progress, current, onPress }: SignatureEpisodeRowProps) {
  const styles = useStyles();
  const number = episode.episode_number !== null ? `Episode ${episode.episode_number}` : null;
  const label = [number, episode.title, progress.meta.toLowerCase()].filter(Boolean).join(', ');

  return (
    <View style={[styles.row, current && styles.current]}>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={label}
        style={({ pressed }) => [styles.pressable, pressed && styles.pressed]}
      >
        <View style={styles.art}>
          {episode.thumbnail_url ? (
            <Image source={{ uri: episode.thumbnail_url }} style={StyleSheet.absoluteFill} resizeMode="cover" />
          ) : null}
          {progress.fraction > 0 ? (
            <View style={styles.track}>
              <View testID={`episode-progress-${episode.id}`} style={[styles.fill, { width: `${progress.fraction * 100}%` }]} />
            </View>
          ) : null}
        </View>
        <View style={styles.text}>
          <AppText variant="ui.bodyBold" numberOfLines={2}>
            {episode.title}
          </AppText>
          {progress.meta ? (
            <AppText variant="mono.meta" tone={progress.state === 'done' ? 'gold' : 'tertiary'}>
              {progress.meta}
            </AppText>
          ) : null}
        </View>
      </Pressable>
      <EpisodeDownloadButton
        episodeId={episode.id}
        episodeTitle={episode.title}
        mediaType={episode.media_type ?? null}
        thumbnailUrl={episode.thumbnail_url}
        category={episode.category_name}
      />
    </View>
  );
}

const useStyles = createThemedStyles((colors) => ({
  row: {
    ...LEAF_SM,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    padding: spacing.sm,
    marginHorizontal: -spacing.sm,
  },
  current: {
    backgroundColor: colors.surface.raised,
  },
  pressable: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  pressed: {
    opacity: 0.7,
  },
  art: {
    ...LEAF_SM,
    width: THUMBNAIL_WIDTH,
    aspectRatio: 16 / 9,
    overflow: 'hidden',
    backgroundColor: colors.surface.sunken,
  },
  track: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 3,
    backgroundColor: colors.overlay.chipBorder,
  },
  fill: {
    height: 3,
    backgroundColor: colors.accent.gold,
  },
  text: {
    flex: 1,
    gap: spacing.xs,
  },
}));
