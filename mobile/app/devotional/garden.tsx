import React, { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText, IconButton } from '../../components';
import { createThemedStyles } from '../../theme/ThemeContext';
import { radius } from '../../theme/radius';
import { spacing } from '../../theme/spacing';
import { addDays, localDate, longDayLabel, monthLabel } from '../../lib/devotionals/dates';
import { gardenOf, streakOf, type JournalEntry } from '../../lib/devotionals/storage';
import { useJournal } from '../../lib/query/hooks/useDevotionals';

/**
 * Word garden (plan-daily-devotional M7): every word the listener kept, newest first,
 * grouped by month. Tapping one opens what they wrote that day. All of it lives on the
 * phone only (D2).
 */
export function groupByMonth(entries: JournalEntry[]): { month: string; entries: JournalEntry[] }[] {
  const groups: { month: string; entries: JournalEntry[] }[] = [];
  for (const e of entries) {
    const month = e.date.slice(0, 7);
    const last = groups[groups.length - 1];
    if (last && last.month === month) last.entries.push(e);
    else groups.push({ month, entries: [e] });
  }
  return groups;
}

export default function WordGardenScreen() {
  const styles = useStyles();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { journal } = useJournal();
  const [open, setOpen] = useState<string | null>(null);
  const entries = journal ? gardenOf(journal) : [];
  const streak = journal ? streakOf(journal, localDate(new Date()), addDays) : 0;

  return (
    <View style={styles.screen}>
      <View style={[styles.header, { paddingTop: Math.max(insets.top, spacing.sm) }]}>
        <IconButton icon="chevron-back" accessibilityLabel="Back" onPress={() => router.back()} />
        <AppText variant="ui.bodyLarge" style={styles.headerTitle}>
          Word garden
        </AppText>
        <View style={styles.headerSpacer} />
      </View>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <AppText variant="ui.body" tone="secondary">
          {entries.length
            ? `${entries.length} word${entries.length === 1 ? '' : 's'} kept${streak > 1 ? ` · ${streak} days in a row` : ''}. Only you can see these.`
            : 'Each day, the word you keep from the passage grows here. Only you can see them.'}
        </AppText>
        {groupByMonth(entries).map((g) => (
          <View key={g.month} style={styles.group}>
            <AppText variant="display.section" accessibilityRole="header">
              {monthLabel(`${g.month}-01`)}
            </AppText>
            <View style={styles.grid}>
              {g.entries.map((e) => {
                const expanded = open === e.date;
                return (
                  <Pressable
                    key={e.date}
                    style={[styles.tile, expanded ? styles.tileOpen : null]}
                    onPress={() => setOpen(expanded ? null : e.date)}
                    accessibilityRole="button"
                    accessibilityState={{ expanded }}
                    accessibilityLabel={`${e.word}, ${longDayLabel(e.date)}`}
                  >
                    <AppText variant="display.row" tone="gold">
                      {e.word}
                    </AppText>
                    <AppText variant="mono.meta" tone="tertiary">
                      {longDayLabel(e.date).toUpperCase()}
                    </AppText>
                    {expanded ? (
                      <View style={styles.detail}>
                        {e.wordVerse ? <AppText variant="display.compact">{`"${e.wordVerse}"`}</AppText> : null}
                        <AppText variant="mono.meta" tone="tertiary">
                          {`${e.title} · ${e.passageRef}`}
                        </AppText>
                        {e.journal ? <AppText variant="ui.body">{e.journal}</AppText> : null}
                        {e.holdUp.length ? (
                          <AppText variant="ui.body" tone="secondary">
                            {`Held up: ${e.holdUp.join(', ')}`}
                          </AppText>
                        ) : null}
                      </View>
                    ) : null}
                  </Pressable>
                );
              })}
            </View>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const useStyles = createThemedStyles((colors) => ({
  screen: { flex: 1, backgroundColor: colors.surface.app },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.sm, paddingBottom: spacing.sm },
  headerTitle: { flex: 1, textAlign: 'center' },
  headerSpacer: { width: 44 },
  content: { padding: spacing.xl, gap: spacing.xxl },
  group: { gap: spacing.md },
  grid: { gap: spacing.sm },
  tile: {
    gap: spacing.xs,
    padding: spacing.lg,
    borderTopLeftRadius: radius.xl,
    borderBottomRightRadius: radius.xl,
    borderTopRightRadius: radius.sm,
    borderBottomLeftRadius: radius.sm,
    backgroundColor: colors.surface.raised,
    borderWidth: 1,
    borderColor: colors.border.default,
  },
  tileOpen: { borderColor: colors.accent.gold },
  detail: { gap: spacing.sm, paddingTop: spacing.sm },
}));
