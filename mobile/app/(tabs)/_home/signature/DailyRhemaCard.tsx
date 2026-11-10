import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { AppText, PrimaryButton } from '../../../../components';
import { createThemedStyles } from '../../../../theme/ThemeContext';
import { spacing } from '../../../../theme/spacing';
import { weekOf, weekdayInitial } from '../../../../lib/devotionals/dates';
import { useDevotionalWindow, useJournal } from '../../../../lib/query/hooks/useDevotionals';
import { LEAF_SM } from './leaf';

/**
 * Home's Daily Rhema card (plan-daily-devotional M2): today's devotional and a week vine
 * of seven leaves, filled for each day completed. Once today is done it shrinks to the
 * kept word. Renders nothing while loading, with nothing to show, or on an error, like the
 * verse card: Home never blocks on it.
 */
export function DailyRhemaCard() {
  const styles = useStyles();
  const router = useRouter();
  const { today, currentDate } = useDevotionalWindow();
  const { journal } = useJournal();
  if (!today) return null;

  const entry = journal?.[today.date];
  const done = Boolean(entry?.completedAt);
  const started = Boolean(entry && !done && entry.step !== 'still');
  const open = () => router.push({ pathname: '/devotional/[date]', params: { date: today.date } });
  const week = weekOf(currentDate);

  if (done) {
    return (
      <Pressable
        style={styles.compact}
        onPress={open}
        accessibilityRole="button"
        accessibilityLabel={`Your word today: ${entry?.word ?? ''}. Open today's devotional.`}
      >
        <AppText variant="mono.meta" tone="gold">
          YOUR WORD TODAY
        </AppText>
        <AppText variant="display.row" tone="gold">
          {entry?.word ?? today.passage.ref}
        </AppText>
        <Vine week={week} journal={journal ?? {}} current={currentDate} />
      </Pressable>
    );
  }

  return (
    <View style={styles.card}>
      <AppText variant="mono.meta" tone="gold">
        DAILY RHEMA
      </AppText>
      <AppText variant="display.title" accessibilityRole="header">
        {today.title}
      </AppText>
      <AppText variant="mono.meta" tone="tertiary">
        {`${today.passage.ref} · ${today.passage.translation}`.toUpperCase()}
      </AppText>
      <View style={styles.actions}>
        <PrimaryButton label={started ? 'Continue quiet time' : 'Begin quiet time'} onPress={open} />
        <Pressable onPress={() => router.push('/devotional/garden')} accessibilityRole="button" hitSlop={spacing.md}>
          <AppText variant="ui.label" tone="gold">
            Word garden
          </AppText>
        </Pressable>
      </View>
      <Vine week={week} journal={journal ?? {}} current={currentDate} />
    </View>
  );
}

function Vine({
  week,
  journal,
  current,
}: {
  week: string[];
  journal: Record<string, { completedAt: string | null }>;
  current: string;
}) {
  const styles = useStyles();
  const doneCount = week.filter((d) => journal[d]?.completedAt).length;
  return (
    <View style={styles.vine} accessible accessibilityLabel={`${doneCount} of 7 days this week`}>
      {week.map((d) => (
        <View key={d} style={styles.vineDay}>
          <View
            style={[
              styles.leaf,
              journal[d]?.completedAt ? styles.leafDone : null,
              d === current ? styles.leafToday : null,
            ]}
          />
          <AppText variant="mono.meta" tone={d === current ? 'gold' : 'tertiary'}>
            {weekdayInitial(d)}
          </AppText>
        </View>
      ))}
    </View>
  );
}

const useStyles = createThemedStyles((colors) => ({
  card: {
    ...LEAF_SM,
    gap: spacing.sm,
    padding: spacing.lg,
    backgroundColor: colors.surface.raised,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.accent.gold,
  },
  compact: {
    ...LEAF_SM,
    gap: spacing.xs,
    padding: spacing.lg,
    backgroundColor: colors.surface.raised,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border.default,
  },
  actions: { flexDirection: 'row', alignItems: 'center', gap: spacing.xl, paddingTop: spacing.sm },
  vine: { flexDirection: 'row', justifyContent: 'space-between', paddingTop: spacing.md },
  vineDay: { alignItems: 'center', gap: spacing.xs },
  leaf: {
    width: 18,
    height: 18,
    borderTopLeftRadius: 9,
    borderBottomRightRadius: 9,
    borderWidth: 1,
    borderColor: colors.border.card,
  },
  leafDone: { backgroundColor: colors.accent.gold, borderColor: colors.accent.gold },
  leafToday: { borderColor: colors.accent.gold },
}));
