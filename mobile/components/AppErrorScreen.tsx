import React, { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { accent, surface, text } from '../theme/colors';
import { reportError } from '../lib/observability/sentry';

export interface AppErrorScreenProps {
  error: Error;
  retry: () => Promise<void>;
}

/**
 * The last-resort screen when a render throws, in place of a white screen or a crash.
 * Expo Router shows it for the route whose layout exports it as `ErrorBoundary`.
 *
 * It sits outside the theme, font and query providers (they may be what failed), so it
 * uses the dark palette directly and the system font.
 */
export function AppErrorScreen({ error, retry }: AppErrorScreenProps) {
  useEffect(() => {
    reportError(error, { boundary: 'route' });
  }, [error]);

  return (
    <View style={styles.root} accessibilityRole="alert">
      <Text style={styles.title} accessibilityRole="header">
        Something went wrong
      </Text>
      <Text style={styles.body}>
        RhemaPod hit an unexpected problem. We have been told about it. Try again, and if it keeps
        happening, close and reopen the app.
      </Text>
      <Pressable
        onPress={() => void retry()}
        accessibilityRole="button"
        accessibilityLabel="Try again"
        style={({ pressed }) => [styles.button, pressed && styles.pressed]}
      >
        <Text style={styles.buttonLabel}>Try again</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: surface.app,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 16,
  },
  title: { color: text.primary, fontSize: 22, fontWeight: '600', textAlign: 'center' },
  body: { color: text.secondary, fontSize: 16, lineHeight: 22, textAlign: 'center' },
  button: {
    marginTop: 8,
    backgroundColor: accent.gold,
    borderRadius: 999,
    paddingVertical: 12,
    paddingHorizontal: 28,
  },
  pressed: { opacity: 0.8 },
  buttonLabel: { color: surface.app, fontSize: 16, fontWeight: '600' },
});
