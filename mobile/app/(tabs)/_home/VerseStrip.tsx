import React from 'react';
import { StyleSheet, View } from 'react-native';
import { AppText } from '../../../components';
import { colors } from '../../../theme/colors';
import { radius } from '../../../theme/radius';
import { spacing } from '../../../theme/spacing';
import { useVerseOfTheDay } from '../../../lib/query/hooks/useVerseOfTheDay';

/**
 * Home's "today" strip (Isaac's ask, session 2026-09-30) — the one piece of this pass
 * that isn't borrowed from an entertainment app: a reason to open daily that's actually
 * true to what RhemaPod is.
 *
 * Backed by `GET /verses/today` (`useVerseOfTheDay`) — the verse itself, the daily
 * pick, and the "same for every viewer, changes at local-midnight-ish granularity"
 * behaviour all live server-side now (`verse_service.get_verse_of_the_day`), not in
 * this component. Quiet failure by design: while loading, on any error, or on the
 * 404 an empty verse table returns, this renders nothing rather than an error banner
 * or a stale placeholder — decorative content earns a "just don't show it" fallback
 * that a real shelf wouldn't.
 */
export function VerseStrip() {
  const { data: verse } = useVerseOfTheDay();

  if (!verse) return null;

  return (
    <View style={styles.strip} accessible accessibilityRole="text">
      <AppText variant="display.compact" tone="primary">
        “{verse.text}”
      </AppText>
      <AppText variant="ui.label" tone="gold" style={styles.reference}>
        {verse.reference} · {verse.translation.toUpperCase()}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  strip: {
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.accent.gold,
    backgroundColor: colors.surface.raised,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: spacing.xs,
  },
  reference: {
    textTransform: 'uppercase',
  },
});
