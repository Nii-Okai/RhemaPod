import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { AppText } from '../../components';
import { colors } from '../../theme/colors';
import { spacing } from '../../theme/spacing';

/**
 * PLACEHOLDER — plan W4.3 explicitly does not build the sermon-detail
 * screen ("W4.1 builds that screen next. Don't build it."). This file
 * exists only so `/sermon/[id]` resolves for typecheck and for the
 * navigation this slice's sermon rows (search results, category/speaker
 * drill-down) already wire up. W4.1 replaces this file's contents wholesale.
 */
export default function SermonDetailPlaceholder() {
  const { id } = useLocalSearchParams<{ id: string }>();

  return (
    <View style={styles.screen}>
      <AppText variant="ui.body" tone="secondary">
        Sermon {id} — detail screen coming in W4.1.
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
