import React, { useEffect, useMemo, useRef } from 'react';
import {
  Animated,
  PanResponder,
  Pressable,
  StyleSheet,
  View,
  type AccessibilityActionEvent,
  type AccessibilityActionInfo,
  type LayoutChangeEvent,
  type HostInstance,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Artwork } from '../Artwork';
import { useEvent } from 'expo';
import type { VideoPlayer } from 'expo-video';
import { useRouter } from 'expo-router';
import { createThemedStyles, useTheme } from '../../theme/ThemeContext';
import { radius } from '../../theme/radius';
import { spacing } from '../../theme/spacing';
import { useNowPlaying, type NowPlayingSession } from '../../lib/playback/nowPlayingContext';
import { setMiniPlayerTop, useMiniPlayerTop } from '../../lib/playback/miniPlayerPosition';
import { currentItem, nextIndex, usePlaybackQueue } from '../../lib/playback/queue';
import { launchPlayerHeroFrom } from '../../lib/playback/playerHero';
import { haptics } from '../../lib/haptics';
import { PlatformIcon } from '../PlatformIcon';
import { AppText } from '../Text';
import { FrostedBackdrop, useFrostBackground } from '../Frosted';

/** The card's own height. */
export const MINI_PLAYER_CARD_HEIGHT = 62;
/** The band the tabs keep for it while docked: the card plus the gap above it. */
export const MINI_PLAYER_SLOT_HEIGHT = MINI_PLAYER_CARD_HEIGHT + spacing.sm;

// A drag has to clear this, and be more vertical than horizontal, before it takes the
// touch from the card's buttons. Short of that a touch is still a tap.
const CLAIM_THRESHOLD = 6;
// Released this close to its home spot, the card docks back into it.
const DOCK_SNAP = 56;
// How far a flick carries the card past where the finger let go, per px/ms of speed:
// the same projection iOS uses for a thrown picture-in-picture window, softened.
const THROW = 160;
// Past either end the card follows the finger at this fraction, then springs back.
const RUBBER_BAND = 0.3;

const ART_RADIUS = 12;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Where the card is drawn mid-drag: with the finger, or resisting past either end. All in
 * translateY units, where 0 is home and `highest` (negative) is the top limit. */
export function dragPosition(raw: number, highest: number): number {
  if (raw < highest) return highest + (raw - highest) * RUBBER_BAND;
  if (raw > 0) return raw * RUBBER_BAND;
  return raw;
}

/** Where the card comes to rest after a release at `released` moving at `vy` px/ms: carried
 * on by the flick, kept on screen, and docked when it ends up near home. */
export function restingPosition(released: number, vy: number, highest: number): number {
  const target = clamp(released + vy * THROW, highest, 0);
  return target > -DOCK_SNAP ? 0 : target;
}

/**
 * The mini player (Daybreak redesign, canvas B1/E1): a card just above the dock while a
 * sermon plays on after its player screen has closed. A lifted navy card with a gold rim
 * and a gold play disc in both themes, so it stands clear of the page (Nii, 2026-11-15).
 * Art, title and speaker; play/pause;
 * a close button that stops it; and a thin gold progress line along its foot. Tapping the
 * card reopens the full player, which picks up where the sermon is. A Next button joins
 * them while something is queued after it.
 *
 * Draggable (Nii, 2026-11-15): with `homeBottom` set, the card floats in a full-size layer
 * and can be dragged up or down anywhere between the status bar and its home spot, where
 * it stays (remembered across screens and launches, `miniPlayerPosition`). It follows the
 * finger, lifts slightly while held, carries on a little when flicked, and springs into
 * place; let go near home and it docks back. Taps and its buttons work as before; a touch
 * only becomes a drag once it moves vertically. VoiceOver/TalkBack get "Move to top" and
 * "Move back down" actions instead.
 *
 * Without `homeBottom` (unit tests) it renders in place, without the drag.
 *
 * Renders nothing while the full player is open or once nothing is playing.
 */
export function MiniPlayer({ floating = false, homeBottom }: { floating?: boolean; homeBottom?: number } = {}) {
  const nowPlaying = useNowPlaying();
  if (!nowPlaying?.session || !nowPlaying.player || nowPlaying.attached) return null;
  const card = (extra?: CardExtras) => (
    <MiniPlayerCard
      session={nowPlaying.session!}
      player={nowPlaying.player!}
      onClose={nowPlaying.stop}
      onNext={nowPlaying.skipToIndex}
      floating={floating}
      {...extra}
    />
  );
  if (homeBottom === undefined) return card();
  return <DraggableLayer homeBottom={homeBottom} renderCard={card} />;
}

/** Whether a mini player is on screen at all (something playing on, full player closed). */
export function useMiniPlayerShowing(): boolean {
  const nowPlaying = useNowPlaying();
  return !!nowPlaying?.session && !!nowPlaying.player && !nowPlaying.attached;
}

/**
 * The band the tabs keep for the docked card, between the content and the dock, so the
 * docked card never covers the end of a list. It closes once the card has been dragged
 * away (the content gets the room back) and opens again when it docks. `onHomeBottom`
 * reports where the band ends, which is where the docked card's bottom edge sits.
 */
export function MiniPlayerSlot({ onHomeBottom }: { onHomeBottom: (y: number) => void }) {
  const showing = useMiniPlayerShowing();
  const top = useMiniPlayerTop();
  const open = showing && top === null;
  return (
    <View
      testID="mini-player-slot"
      pointerEvents="none"
      style={{ height: open ? MINI_PLAYER_SLOT_HEIGHT : 0 }}
      onLayout={(event: LayoutChangeEvent) => {
        const { y, height } = event.nativeEvent.layout;
        onHomeBottom(y + height);
      }}
    />
  );
}

interface CardExtras {
  /** In the draggable layer: no band behind it, no gap above it. */
  layered?: boolean;
  accessibilityActions?: AccessibilityActionInfo[];
  onAccessibilityAction?: (event: AccessibilityActionEvent) => void;
}

function DraggableLayer({
  homeBottom,
  renderCard,
}: {
  homeBottom: number;
  renderCard: (extra: CardExtras) => React.ReactNode;
}) {
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const savedTop = useMiniPlayerTop();

  // Everything below is in translateY units: 0 is the home spot, negative is higher up.
  const homeTop = homeBottom - MINI_PLAYER_CARD_HEIGHT;
  const highest = Math.min(0, insets.top + spacing.sm - homeTop);
  const settled = savedTop === null ? 0 : clamp(savedTop - homeTop, highest, 0);

  const translateY = useRef(new Animated.Value(settled)).current;
  const lift = useRef(new Animated.Value(0)).current;
  const bounds = useRef({ highest, homeTop });
  bounds.current = { highest, homeTop };
  const busy = useRef(false);
  const dragStart = useRef(0);

  // Follow the saved spot when it changes from elsewhere (the other host, a stored value
  // read at launch, a rotation), but never yank the card out from under a drag or a spring.
  useEffect(() => {
    if (!busy.current) translateY.setValue(settled);
  }, [settled, translateY]);

  const settleAt = (target: number, velocity = 0) => {
    busy.current = true;
    Animated.spring(translateY, {
      toValue: target,
      velocity: clamp(velocity * 1000, -4000, 4000),
      stiffness: 260,
      damping: 26,
      mass: 1,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (!finished) return; // grabbed again mid-flight; that drag will commit
      busy.current = false;
      setMiniPlayerTop(target === 0 ? null : bounds.current.homeTop + target);
    });
  };

  const setLifted = (lifted: boolean) =>
    Animated.spring(lift, { toValue: lifted ? 1 : 0, speed: 30, bounciness: 0, useNativeDriver: true }).start();

  const pan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponderCapture: (_event, g) =>
          Math.abs(g.dy) > CLAIM_THRESHOLD && Math.abs(g.dy) > Math.abs(g.dx),
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => {
          busy.current = true;
          translateY.stopAnimation((value) => {
            dragStart.current = value;
          });
          setLifted(true);
          haptics.grab();
        },
        onPanResponderMove: (_event, g) => {
          translateY.setValue(dragPosition(dragStart.current + g.dy, bounds.current.highest));
        },
        onPanResponderRelease: (_event, g) => {
          const released = dragPosition(dragStart.current + g.dy, bounds.current.highest);
          setLifted(false);
          haptics.settle();
          settleAt(restingPosition(released, g.vy, bounds.current.highest), g.vy);
        },
        onPanResponderTerminate: () => {
          setLifted(false);
          settleAt(clamp(dragStart.current, bounds.current.highest, 0));
        },
      }),
    // The handlers read live values through refs, so one responder serves for good.
    [],
  );

  const docked = savedTop === null;
  const actions: AccessibilityActionInfo[] = docked
    ? [{ name: 'moveUp', label: 'Move to top' }]
    : [{ name: 'moveDown', label: 'Move back down' }];
  const onAccessibilityAction = (event: AccessibilityActionEvent) => {
    if (event.nativeEvent.actionName === 'moveUp') settleAt(highest);
    else if (event.nativeEvent.actionName === 'moveDown') settleAt(0);
  };

  const scale = lift.interpolate({ inputRange: [0, 1], outputRange: [1, 1.03] });

  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      <Animated.View
        testID="mini-player-layer"
        {...pan.panHandlers}
        style={[styles.layerCard, { top: homeTop, transform: [{ translateY }, { scale }] }]}
      >
        {renderCard({ layered: true, accessibilityActions: actions, onAccessibilityAction })}
      </Animated.View>
    </View>
  );
}

function MiniPlayerCard({
  session,
  player,
  onClose,
  onNext,
  floating,
  layered,
  accessibilityActions,
  onAccessibilityAction,
}: CardExtras & {
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
  const cardBackground = useFrostBackground('card');
  const fraction = player.duration > 0 ? Math.min(1, Math.max(0, currentTime / player.duration)) : 0;

  // The art grows out of the card into the full player (`lib/playback/playerHero.ts`).
  const artRef = useRef<HostInstance>(null);
  const openPlayer = () =>
    launchPlayerHeroFrom(artRef.current, { sermonId: session.sermonId, uri: session.artworkUrl, radius: ART_RADIUS }, () =>
      router.push({ pathname: '/player/[id]', params: { id: session.sermonId } }),
    );

  return (
    <View testID="mini-player" style={[styles.wrap, floating && styles.wrapFloating, layered && styles.wrapLayered]}>
      <View style={[styles.lift, { backgroundColor: cardBackground }]}>
        <Pressable
          onPress={openPlayer}
          accessibilityRole="button"
          accessibilityLabel={`Now playing: ${session.title}. Open the player.`}
          accessibilityActions={accessibilityActions}
          onAccessibilityAction={onAccessibilityAction}
          style={({ pressed }) => [styles.card, { backgroundColor: cardBackground }, pressed && styles.pressed]}
        >
          <FrostedBackdrop variant="card" borderRadius={20} />
          {session.artworkUrl ? (
            <View ref={artRef} collapsable={false}>
              <Artwork uri={session.artworkUrl} style={styles.art} accessible={false} />
            </View>
          ) : (
            <View style={[styles.art, styles.artBlank]}>
              <PlatformIcon name={session.mediaType === 'video' ? 'play' : 'volume-high-outline'} size={18} color={colors.feature.sun} />
            </View>
          )}
          <View style={styles.text}>
            <AppText variant="ui.bodyBold" numberOfLines={1} style={styles.title}>
              {session.title}
            </AppText>
            {session.artist ? (
              <AppText variant="ui.badge" numberOfLines={1} style={styles.subtitle}>
                {session.artist}
              </AppText>
            ) : null}
          </View>
          <Pressable
            onPress={() => {
              haptics.tap();
              if (isPlaying) player.pause();
              else player.play();
            }}
            accessibilityRole="button"
            accessibilityLabel={isPlaying ? 'Pause' : 'Play'}
            hitSlop={spacing.xs}
            style={({ pressed }) => [styles.playDisc, pressed && styles.pressed]}
          >
            <PlatformIcon name={isPlaying ? 'pause' : 'play'} size={22} color={colors.miniPlayer.playIcon} />
          </Pressable>
          {queued !== null ? (
            <Pressable
              onPress={() => {
                haptics.tap();
                onNext(queued);
              }}
              accessibilityRole="button"
              accessibilityLabel="Play next in queue"
              hitSlop={spacing.xs}
              style={({ pressed }) => [styles.control, pressed && styles.pressed]}
            >
              <PlatformIcon name="play-skip-forward" size={22} color={colors.miniPlayer.icon} />
            </Pressable>
          ) : null}
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Stop and close the player"
            hitSlop={spacing.xs}
            style={({ pressed }) => [styles.control, pressed && styles.pressed]}
          >
            <PlatformIcon name="close" size={20} color={colors.miniPlayer.iconMuted} />
          </Pressable>
          <View testID="mini-player-track" style={styles.track} pointerEvents="none">
            <View style={[styles.bar, { width: `${fraction * 100}%` }]} />
          </View>
        </Pressable>
      </View>
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
  wrapLayered: {
    backgroundColor: 'transparent',
    paddingTop: 0,
  },
  layerCard: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: MINI_PLAYER_CARD_HEIGHT,
  },
  // Carries the drop shadow the clipped card can't (and, on Android, the elevation, which
  // needs the view's own background).
  lift: {
    borderRadius: 20,
    shadowColor: colors.miniPlayer.shadow,
    shadowOpacity: 1,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 12,
  },
  card: {
    height: MINI_PLAYER_CARD_HEIGHT,
    borderRadius: 20,
    overflow: 'hidden',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingLeft: spacing.sm,
    paddingRight: spacing.xs,
    // Frosted like the dock (`Frosted`), set inline, but a lifted navy in both themes and
    // nearly opaque, with a gold rim, so it can't be mistaken for the page
    // (`colors.miniPlayer`, Nii 2026-11-15).
    borderWidth: 1,
    borderColor: colors.miniPlayer.rim,
  },
  pressed: {
    opacity: 0.8,
  },
  art: {
    width: 46,
    height: 46,
    borderRadius: ART_RADIUS,
  },
  artBlank: {
    backgroundColor: colors.feature.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    color: colors.miniPlayer.title,
  },
  subtitle: {
    color: colors.miniPlayer.subtitle,
  },
  playDisc: {
    width: 40,
    height: 40,
    marginHorizontal: 2,
    borderRadius: radius.pill,
    backgroundColor: colors.miniPlayer.playBg,
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
    backgroundColor: colors.miniPlayer.track,
  },
  bar: {
    height: 3,
    backgroundColor: colors.miniPlayer.progress,
  },
}));
