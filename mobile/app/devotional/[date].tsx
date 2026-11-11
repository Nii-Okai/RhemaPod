import React, { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Speech from 'expo-speech';
import { AppText, IconButton, LinkButton, PrimaryButton, SkeletonBlock } from '../../components';
import { createThemedStyles } from '../../theme/ThemeContext';
import { spacing } from '../../theme/spacing';
import { radius } from '../../theme/radius';
import { longDayLabel } from '../../lib/devotionals/dates';
import { STEPS, type Devotional, type JournalEntry, type Step } from '../../lib/devotionals/storage';
import { useDevotionalWindow, useJournal } from '../../lib/query/hooks/useDevotionals';
import { CarryStep, HearStep, PonderStep, PrayStep, StillStep } from './_flow/steps';

/**
 * Daily Rhema quiet time (plan-daily-devotional M3): Still → Hear → Ponder → Pray → Carry,
 * one step per screen with a five-leaf progress row. Progress, the kept word and the
 * journal save to the phone as the listener goes (D2), so closing and reopening resumes
 * at the furthest step reached. Only an unlocked day (its date and publish hour have
 * arrived) can be opened.
 */
/** The route param that means "whatever today's devotional is". */
const TODAY = 'today';

const TITLES: Record<Step, string> = {
  still: 'Still',
  hear: 'Hear',
  ponder: 'Ponder',
  pray: 'Pray',
  carry: 'Carry',
};

export default function DevotionalScreen() {
  const { date: param } = useLocalSearchParams<{ date: string }>();
  const router = useRouter();
  const window = useDevotionalWindow();
  const { journal, loaded, update } = useJournal();
  // `/devotional/today` (the tab dock's Today button) resolves here, against the church's
  // real publish hour, so the dock never has to load devotional data itself.
  const date = param === TODAY ? window.currentDate : param;
  const dev = window.days.find((d) => d.date === date) ?? null;

  if (window.isLoading || !loaded) {
    return <Loading />;
  }
  if (!dev) {
    return <NotAvailable onBack={() => router.back()} onGarden={() => router.replace('/devotional/garden')} />;
  }
  return <Flow dev={dev} entry={journal?.[dev.date]} update={(patch) => update(dev, patch)} />;
}

function NotAvailable({ onBack, onGarden }: { onBack: () => void; onGarden: () => void }) {
  const styles = useStyles();
  return (
    <View style={[styles.screen, styles.loading]} accessibilityLiveRegion="polite">
      <AppText variant="display.section" accessibilityRole="header">
        This devotional isn&apos;t available
      </AppText>
      <AppText variant="ui.body" tone="secondary">
        It may not be out yet, or it&apos;s older than this phone keeps. Your kept words are in the word garden.
      </AppText>
      <PrimaryButton label="Back" onPress={onBack} />
      <LinkButton label="Open the word garden" onPress={onGarden} />
    </View>
  );
}

function Loading() {
  const styles = useStyles();
  return (
    <View style={[styles.screen, styles.loading]} accessibilityRole="progressbar" accessibilityLabel="Loading devotional">
      <SkeletonBlock width="60%" height={22} />
      <SkeletonBlock width="90%" height={120} />
    </View>
  );
}

function Flow({
  dev,
  entry,
  update,
}: {
  dev: Devotional;
  entry: JournalEntry | undefined;
  update: (patch: Partial<Omit<JournalEntry, 'date' | 'devotionalId'>>) => void;
}) {
  const styles = useStyles();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const scroll = useRef<ScrollView>(null);
  // Resume where the listener left off; a finished day opens on Carry.
  const [step, setStep] = useState<Step>(entry?.completedAt ? 'carry' : entry?.step ?? 'still');
  const index = STEPS.indexOf(step);

  useEffect(() => {
    if (!entry) update({ step: 'still' });
    // Create the entry once, on first open.
  }, []);

  const go = (next: Step) => {
    void Speech.stop();
    setStep(next);
    update({ step: next });
    scroll.current?.scrollTo({ y: 0, animated: false });
  };
  const finish = () => {
    void Speech.stop();
    update({
      step: 'carry',
      completedAt: entry?.completedAt ?? new Date().toISOString(),
      word: entry?.word ?? dev.suggested_word ?? null,
    });
    router.back();
  };

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={[styles.header, { paddingTop: Math.max(insets.top, spacing.sm) }]}>
        <IconButton icon="close" accessibilityLabel="Close. Your place is saved." onPress={() => router.back()} />
        <View
          style={styles.leaves}
          accessible
          accessibilityRole="progressbar"
          accessibilityLabel={`Step ${index + 1} of 5, ${TITLES[step]}`}
        >
          {STEPS.map((s, i) => (
            <View key={s} style={[styles.leaf, i <= index ? styles.leafOn : null]} />
          ))}
        </View>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView
        ref={scroll}
        style={styles.flex}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.titleBlock}>
          <AppText variant="mono.meta" tone="gold">
            {`${TITLES[step].toUpperCase()} · ${longDayLabel(dev.date).toUpperCase()}`}
          </AppText>
          {step !== 'still' && step !== 'carry' ? (
            <AppText variant="display.section" accessibilityRole="header">
              {dev.title}
            </AppText>
          ) : null}
        </View>
        {step === 'still' ? <StillStep dev={dev} onDone={() => go('hear')} /> : null}
        {step === 'hear' ? <HearStep dev={dev} entry={entry} update={update} /> : null}
        {step === 'ponder' ? <PonderStep dev={dev} /> : null}
        {step === 'pray' ? <PrayStep dev={dev} entry={entry} update={update} /> : null}
        {step === 'carry' ? <CarryStep dev={dev} entry={entry} onGarden={() => router.push('/devotional/garden')} /> : null}
      </ScrollView>

      {step !== 'still' ? (
        <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]}>
          <IconButton icon="chevron-back" accessibilityLabel="Previous step" onPress={() => go(STEPS[index - 1])} />
          <View style={styles.flex}>
            {step === 'carry' ? (
              <PrimaryButton label={entry?.completedAt ? 'Close' : 'Amen'} onPress={finish} fullWidth />
            ) : (
              <PrimaryButton label={`Continue to ${TITLES[STEPS[index + 1]]}`} onPress={() => go(STEPS[index + 1])} fullWidth />
            )}
          </View>
        </View>
      ) : null}
    </KeyboardAvoidingView>
  );
}

const useStyles = createThemedStyles((colors) => ({
  screen: { flex: 1, backgroundColor: colors.surface.app },
  loading: { padding: spacing.xxl, gap: spacing.lg, justifyContent: 'center' },
  flex: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.sm, paddingBottom: spacing.sm },
  headerSpacer: { width: 44 },
  leaves: { flex: 1, flexDirection: 'row', justifyContent: 'center', gap: spacing.sm },
  leaf: {
    width: 22,
    height: 8,
    borderTopLeftRadius: radius.md,
    borderBottomRightRadius: radius.md,
    backgroundColor: colors.track.default,
  },
  leafOn: { backgroundColor: colors.accent.gold },
  content: { flexGrow: 1, paddingHorizontal: spacing.xxl, paddingBottom: spacing.xxl, gap: spacing.lg },
  titleBlock: { gap: spacing.xs, paddingTop: spacing.sm },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border.default,
    backgroundColor: colors.surface.app,
  },
}));
