import React from 'react';
import { Pressable, View } from 'react-native';
import { Artwork } from '../Artwork';
import { useEvent } from 'expo';
import type { VideoPlayer } from 'expo-video';
import { useRouter } from 'expo-router';
import { createThemedStyles, useTheme } from '../../theme/ThemeContext';
import { radius } from '../../theme/radius';
import { spacing } from '../../theme/spacing';
import { useNowPlaying, type NowPlayingSession } from '../../lib/playback/nowPlayingContext';
import { currentItem, nextIndex, usePlaybackQueue } from '../../lib/playback/queue';
import { PlatformIcon } from '../PlatformIcon';
import { AppText } from '../Text';

/**
 * The mini player (Daybreak redesign, canvas B1/E1): a card just above the dock while a
 * sermon plays on after its player screen has closed. Art, title and speaker; play/pause;
 * a close button that stops it; and a thin gold progress line along its foot. Tapping the
 * card reopens the full player, which picks up where the sermon is. A Next button joins
 * them while something is queued after it.
 *
 * Renders nothing while the full player is open or once nothing is playing.
 */
export function MiniPlayer({ floating = false }: { floating?: boolean } = {}) {
  const nowPlaying = useNowPlaying();
  if (!nowPlaying?.session || !nowPlaying.player || nowPlaying.attached) return null;
  return (
    <MiniPlayerCard
      session={nowPlaying.session}
      player={nowPlaying.player}
      onClose={nowPlaying.stop}
      onNext={nowPlaying.skipToIndex}
      floating={floating}
    />
  );
}

function MiniPlayerCard({
  session,
  player,
  onClose,
  onNext,
  floating,
}: {
  session: NowPlayingSession;
  player: VideoPlayer;
  onClose: () => void;
  onNext: (index: number) => void;
  /** Over a pushed screen (`StackMiniPlayer`): no page-coloured band behind the card. */
  floating: boolean;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const router = useRouter();
  const { isPlaying } = useEvent(player, 'playingChange', { isPlaying: player.playing });
  const { currentTime } = useEvent(player, 'timeUpdate', {
    currentTime: player.currentTime,
    currentLiveTimestamp: null,
    currentOffsetFromLive: null,
    bufferedPosition: player.bufferedPosition,
  });
  const queue = usePlaybackQueue();
  const queued = currentItem(queue)?.sermonId === session.sermonId ? nextIndex(queue) : null;
  const fraction = player.duration > 0 ? Math.min(1, Math.max(0, currentTime / player.duration)) : 0;

  return (
    <View testID="mini-player" style={[styles.wrap, floating && styles.wrapFloating]}>
      <Pressable
        onPress={() => router.push({ pathname: '/player/[id]', params: { id: session.sermonId } })}
        accessibilityRole="button"
        accessibilityLabel={`Now playing: ${session.title}. Open the player.`}
        style={({ pressed }) => [styles.card, pressed && styles.pressed]}
      >
        {session.artworkUrl ? (
          <Artwork uri={session.artworkUrl} style={styles.art} accessible={false} />
        ) : (
          <View style={[styles.art, styles.artBlank]}>
            <PlatformIcon name={session.mediaType === 'video' ? 'play' : 'volume-high-outline'} size={18} color={colors.feature.sun} />
          </View>
        )}
        <View style={styles.text}>
          <AppText variant="ui.bodyBold" numberOfLines={1}>
            {session.title}
          </AppText>
          {session.artist ? (
            <AppText variant="ui.badge" tone="tertiary" numberOfLines={1}>
              {session.artist}
            </AppText>
          ) : null}
        </View>
        <Pressable
          onPress={() => (isPlaying ? player.pause() : player.play())}
          accessibilityRole="button"
          accessibilityLabel={isPlaying ? 'Pause' : 'Play'}
          hitSlop={spacing.xs}
          style={({ pressed }) => [styles.control, pressed && styles.pressed]}
        >
          <PlatformIcon name={isPlaying ? 'pause' : 'play'} size={24} color={colors.text.primary} />
        </Pressable>
        {queued !== null ? (
          <Pressable
            onPress={() => onNext(queued)}
            accessibilityRole="button"
            accessibilityLabel="Play next in queue"
            hitSlop={spacing.xs}
            style={({ pressed }) => [styles.control, pressed && styles.pressed]}
          >
            <PlatformIcon name="play-skip-forward" size={22} color={colors.text.primary} />
          </Pressable>
        ) : null}
        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Stop and close the player"
          hitSlop={spacing.xs}
          style={({ pressed }) => [styles.control, pressed && styles.pressed]}
        >
          <PlatformIcon name="close" size={20} color={colors.text.tertiary} />
        </Pressable>
        <View style={styles.track} pointerEvents="none">
          <View style={[styles.bar, { width: `${fraction * 100}%` }]} />
        </View>
      </Pressable>
    </View>
  );
}

const useStyles = createThemedStyles((colors) => ({
  wrap: {
    backgroundColor: colors.surface.app,
    paddingHorizontal: spacing.md + 2,
    paddingTop: spacing.sm,
  },
  wrapFloating: {
    backgroundColor: 'transparent',
  },
  card: {
    height: 62,
    borderRadius: 20,
    overflow: 'hidden',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingLeft: spacing.sm,
    paddingRight: spacing.xs,
    backgroundColor: colors.surface.raised,
    borderWidth: 1,
    borderColor: colors.border.default,
  },
  pressed: {
    opacity: 0.8,
  },
  art: {
    width: 46,
    height: 46,
    borderRadius: 12,
  },
  artBlank: {
    backgroundColor: colors.feature.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  control: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  track: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 3,
  },
  bar: {
    height: 3,
    backgroundColor: colors.sunButton.bg,
  },
}));
