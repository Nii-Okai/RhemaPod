import React, { useState } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSegments } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MiniPlayer } from './MiniPlayer';

/** Routes that never show it: the tabs draw their own above the dock, and these are
 * either the player itself or full-screen flows with their own footer. */
const HIDDEN = new Set(['(tabs)', '(auth)', 'onboarding', 'index', 'player', 'devotional', 'delete-account']);

/**
 * The mini player over pushed screens (series, sermon, playlist, speaker, topic, search,
 * notifications and so on). The tab group draws its own above the dock; until now nothing
 * drew it once a screen was pushed over the tabs (Nii's phone test, 2026-11-11). It floats
 * at the foot of the screen, over the content, and can be dragged up from there; it keeps
 * the spot it was dragged to on the tabs too (`MiniPlayer`).
 */
export function StackMiniPlayer() {
  const segments = useSegments() as string[];
  const insets = useSafeAreaInsets();
  const window = useWindowDimensions();
  const [height, setHeight] = useState<number | null>(null);
  const first = segments[0];
  if (!first || HIDDEN.has(first)) return null;
  if (first === 'playlist' && segments[1] === 'create') return null;
  const homeBottom = (height ?? window.height) - Math.max(insets.bottom, 12);
  return (
    <View
      pointerEvents="box-none"
      style={StyleSheet.absoluteFill}
      onLayout={(event) => setHeight(event.nativeEvent.layout.height)}
    >
      <MiniPlayer floating homeBottom={homeBottom} />
    </View>
  );
}
