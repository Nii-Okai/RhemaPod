import React from 'react';
import { View } from 'react-native';
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
 * at the foot of the screen, over the content.
 */
export function StackMiniPlayer() {
  const segments = useSegments() as string[];
  const insets = useSafeAreaInsets();
  const first = segments[0];
  if (!first || HIDDEN.has(first)) return null;
  if (first === 'playlist' && segments[1] === 'create') return null;
  return (
    <View
      pointerEvents="box-none"
      style={{ position: 'absolute', left: 0, right: 0, bottom: 0, paddingBottom: Math.max(insets.bottom, 12) }}
    >
      <MiniPlayer floating />
    </View>
  );
}
