import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { AppText } from '../../components';
import { colors } from '../../theme/colors';
import { spacing } from '../../theme/spacing';

/**
 * PLACEHOLDER — W4.2 builds the real player (`expo-video` on a Stream signed URL,
 * transport controls, speed, sleep timer, background audio, lock-screen controls, the
 * Notes drawer, progress flush per plan L16). This file exists only so `/player/[id]`
 * resolves for typecheck/navigation — W4.1's sermon-detail CTA (Play/Listen/Resume)
 * already pushes here. W4.2 replaces this file's contents wholesale.
 */
export default function PlayerPlaceholder() {
  const { id } = useLocalSearchParams<{ id: string }>();

  return (
    <View style={styles.screen}>
      <AppText variant="ui.body" tone="secondary">
        Player for sermon {id} — coming in W4.2.
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.surface.app,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
});
