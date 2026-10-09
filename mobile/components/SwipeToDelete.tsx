import React, { useRef, useState } from 'react';
import { Animated, PanResponder, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AppText } from './Text';
import { colors } from '../theme/colors';
import { radius } from '../theme/radius';
import { spacing } from '../theme/spacing';

const ACTION_WIDTH = 84;
const OPEN_THRESHOLD = ACTION_WIDTH / 2;
// A drag has to clear this before the gesture claims the touch, and clearly more
// horizontal than vertical — short of that, the outer `ScrollView`'s own vertical scroll
// wins, same disambiguation a native swipeable list row uses.
const CLAIM_THRESHOLD = 8;

export interface SwipeToDeleteProps {
  children: React.ReactNode;
  onDelete: () => void;
  /** Read by VoiceOver/TalkBack as this row's custom "Delete" action (see the component
   * doc below) — e.g. "Delete downloaded A Great Sermon", not just "Delete". */
  deleteAccessibilityLabel: string;
  /** On the outer wrapper — lets a test reach the `accessibilityActions`/
   * `onAccessibilityAction` pair directly, since that element has no `accessibilityLabel`
   * of its own to query by (the swipe-revealed button underneath carries one, but it's
   * `pointerEvents: 'none'` until swiped open, which `fireEvent.press` correctly refuses
   * to fire on — exactly as a real, not-yet-revealed touch would). */
  testID?: string;
}

/**
 * Swipe-left-to-reveal delete, built on core `PanResponder` + `Animated` (Isaac's ask,
 * session 2026-10-09: "the delete button is old fashioned, use something native,
 * creative and unique") — no `react-native-gesture-handler`/reanimated dependency added
 * for this: `PanResponder` already ships in React Native core and is the same primitive
 * every pre-Reanimated native-feeling swipeable list used, so this gets the native Mail/
 * Messages-style interaction without a new native module (and the rebuild it'd force).
 *
 * The row drags with the finger, snaps open past `OPEN_THRESHOLD` or springs shut
 * otherwise, and a tap on the (still-visible, now-shifted) row content while open closes
 * it rather than firing its normal action — standard swipeable-row behavior. Pressing the
 * revealed red action slides the whole row the rest of the way off-screen and fades it
 * before calling `onDelete`, so removal reads as the row leaving, not a hard cut.
 *
 * A raw swipe gesture is invisible to VoiceOver/TalkBack (and actively conflicts with
 * their own left/right swipe navigation), so the whole row also exposes an
 * `accessibilityActions` "Delete" entry wired to `onAccessibilityAction` — reachable from
 * the rotor, no swipe required.
 */
export function SwipeToDelete({ children, onDelete, deleteAccessibilityLabel, testID }: SwipeToDeleteProps) {
  const translateX = useRef(new Animated.Value(0)).current;
  const openRef = useRef(false);
  const dragStartX = useRef(0);
  const [isOpen, setIsOpen] = useState(false);

  const snapTo = (toValue: number) => {
    openRef.current = toValue !== 0;
    setIsOpen(openRef.current);
    Animated.spring(translateX, { toValue, useNativeDriver: true, speed: 20, bounciness: 4 }).start();
  };

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_evt, gesture) =>
        Math.abs(gesture.dx) > CLAIM_THRESHOLD && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 2,
      onPanResponderGrant: () => {
        dragStartX.current = openRef.current ? -ACTION_WIDTH : 0;
      },
      onPanResponderMove: (_evt, gesture) => {
        const next = Math.min(0, Math.max(-ACTION_WIDTH, dragStartX.current + gesture.dx));
        translateX.setValue(next);
      },
      onPanResponderRelease: (_evt, gesture) => {
        const current = dragStartX.current + gesture.dx;
        snapTo(current <= -OPEN_THRESHOLD ? -ACTION_WIDTH : 0);
      },
      onPanResponderTerminate: () => snapTo(openRef.current ? -ACTION_WIDTH : 0),
    }),
  ).current;

  const handleDeletePress = () => {
    // Fire-and-forget, not gated behind the animation's own completion callback: `onDelete`
    // goes on to do real async work (file deletes, a DB row, a store refresh — see
    // `useDownloads.ts`'s `remove`), which typically outlasts this 220ms slide anyway and
    // unmounts the row once it resolves. Waiting for the animation first would only add a
    // needless delay before that real work even starts, for a visual payoff that's already
    // playing underneath it.
    Animated.timing(translateX, { toValue: -480, duration: 220, useNativeDriver: true }).start();
    onDelete();
  };

  return (
    <View
      style={styles.wrap}
      testID={testID}
      accessibilityActions={[{ name: 'delete', label: 'Delete' }]}
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === 'delete') onDelete();
      }}
    >
      <View style={styles.actionLayer} pointerEvents={isOpen ? 'auto' : 'none'}>
        <Pressable
          onPress={handleDeletePress}
          accessibilityRole="button"
          accessibilityLabel={deleteAccessibilityLabel}
          style={({ pressed }) => [styles.actionButton, pressed && styles.actionButtonPressed]}
        >
          <Ionicons name="trash" size={20} color={colors.status.rose.text} />
          <AppText variant="ui.label" style={styles.actionLabel}>
            Delete
          </AppText>
        </Pressable>
      </View>
      <Animated.View style={[styles.foreground, { transform: [{ translateX }] }]} {...panResponder.panHandlers}>
        {children}
        {isOpen ? (
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => snapTo(0)}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          />
        ) : null}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    overflow: 'hidden',
    borderRadius: radius.lg,
  },
  actionLayer: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'flex-end',
    justifyContent: 'center',
    backgroundColor: colors.status.rose.bg,
  },
  actionButton: {
    width: ACTION_WIDTH,
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  actionButtonPressed: {
    opacity: 0.7,
  },
  actionLabel: {
    color: colors.status.rose.text,
  },
  foreground: {
    backgroundColor: colors.surface.raised,
    borderColor: colors.border.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.lg,
  },
});
