import React from 'react';
import { Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';
import { AppText, PlatformIcon } from '../../../../components';
import { createThemedStyles, useTheme } from '../../../../theme/ThemeContext';
import { radius } from '../../../../theme/radius';
import { spacing } from '../../../../theme/spacing';
import { weekOf, weekdayInitial } from '../../../../lib/devotionals/dates';
import { STEPS, type Step } from '../../../../lib/devotionals/storage';
import { useDevotionalWindow, useJournal } from '../../../../lib/query/hooks/useDevotionals';

const STEP_LABEL: Record<Step, string> = {
  still: 'Still',
  hear: 'Hear',
  ponder: 'Ponder',
  pray: 'Pray',
  carry: 'Carry',
};

/**
 * Home's Daily Rhema card (Daybreak redesign, canvas B1/B2; plan-daily-devotional M2).
 *
 * Before today's quiet time is finished it is the navy feature card in both themes: the
 * day's title and passage, five segments for Still · Hear · Ponder · Pray · Carry, a gold
 * Begin (or Continue at the step reached) button and the count of words kept so far,
 * which opens the word garden. Once today is done it becomes a calm green "Quiet time
 * done" card with the kept word and this week's vine of seven leaves.
 *
 * Renders nothing while loading, with nothing to show, or on an error, like the verse
 * card: Home never blocks on it.
 */
export function DailyRhemaCard() {
  const styles = useStyles();
  const { colors } = useTheme();
  const router = useRouter();
  const { today, currentDate } = useDevotionalWindow();
  const { journal } = useJournal();
  if (!today) return null;

  const entry = journal?.[today.date];
  const done = Boolean(entry?.completedAt);
  const started = Boolean(entry && !done && entry.step !== 'still');
  const reached = entry ? STEPS.indexOf(entry.step) + (done ? 1 : 0) : 0;
  const open = () => router.push({ pathname: '/devotional/[date]', params: { date: today.date } });
  const openGarden = () => router.push('/devotional/garden');
  const keptWords = Object.values(journal ?? {}).filter((e) => e.completedAt && e.word).length;

  if (done) {
    return (
      <Pressable
        style={({ pressed }) => [styles.done, pressed && styles.pressed]}
        onPress={openGarden}
        accessibilityRole="button"
        accessibilityLabel={`Quiet time done. You kept the word ${entry?.word ?? ''}. Open your word garden.`}
      >
        <View style={styles.doneTop}>
          <View style={styles.check}>
            <PlatformIcon name="checkmark" size={20} color={colors.status.sage.bg} />
          </View>
          <View style={styles.doneText}>
            <AppText variant="ui.bodyBold" style={styles.doneTitle}>
              Quiet time done
            </AppText>
            <AppText variant="ui.body" style={styles.doneTitle}>
              You kept the word
            </AppText>
          </View>
          <PlatformIcon name="chevron-forward" size={20} color={colors.status.sage.text} />
        </View>
        <AppText variant="display.title" style={styles.doneWord}>
          {entry?.word ?? today.passage.ref}
        </AppText>
        <Vine week={weekOf(currentDate)} journal={journal ?? {}} current={currentDate} />
      </Pressable>
    );
  }

  return (
    <View style={styles.card}>
      <View style={[styles.orb, styles.orbBig]} />
      <GlassSun />
      <View style={styles.body}>
        <AppText variant="ui.badge" style={styles.eyebrow}>
          DAILY RHEMA · YOUR WORD TODAY
        </AppText>
        <AppText variant="display.title" accessibilityRole="header" style={styles.title}>
          {today.title}
        </AppText>
        <AppText variant="mono.meta" style={styles.meta}>
          {`${today.passage.ref} · ${today.passage.translation}`.toUpperCase()}
        </AppText>
        <View
          style={styles.steps}
          accessible
          accessibilityLabel={`${reached} of 5 steps: Still, Hear, Ponder, Pray, Carry`}
        >
          {STEPS.map((step, i) => (
            <View key={step} style={[styles.step, i < reached && styles.stepDone]} />
          ))}
        </View>
        <View style={styles.actions}>
          <Pressable
            onPress={open}
            accessibilityRole="button"
            style={({ pressed }) => [styles.sun, pressed && styles.pressed]}
          >
            <AppText variant="ui.button" style={styles.sunText}>
              {started && entry ? `Continue · ${STEP_LABEL[entry.step]}` : 'Begin quiet time'}
            </AppText>
          </Pressable>
          <Pressable
            onPress={openGarden}
            accessibilityRole="button"
            accessibilityLabel={keptWords > 0 ? `Word garden, ${keptWords} words kept` : 'Word garden'}
            hitSlop={spacing.md}
            style={styles.garden}
          >
            <PlatformIcon name="leaf-outline" size={18} color={colors.feature.eyebrow} />
            <AppText variant="ui.label" style={styles.gardenText}>
              {keptWords > 0 ? `${keptWords} ${keptWords === 1 ? 'word' : 'words'}` : 'Word garden'}
            </AppText>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const SUN = 86;
const GLOW = 40;
// How see-through each part of the glass sun is. Kept low so it sits back in the card
// (Nii, 2026-11-12: "the sun looks too bright"). Set as stop/stroke opacity, never as an
// rgba alpha, which the first build showed does not come through on device.
const sunGlassOpacity = { core: 0.3, edge: 0.12, rim: 0.38, glow: 0.1 };

/**
 * The glass sun (Nii, 2026-11-12, canvas D7 option A): see-through gold, brighter at its
 * centre, with a gold rim and a soft glow, so the big circle behind it shows through
 * instead of a solid disc shouting over it.
 */
function GlassSun() {
  const { colors } = useTheme();
  const size = SUN + GLOW * 2;
  const c = size / 2;
  return (
    <View pointerEvents="none" style={glassSunPosition} testID="daily-rhema-sun">
      <Svg width={size} height={size}>
        <Defs>
          <RadialGradient id="rhemaSunGlow" cx="50%" cy="50%" r="50%">
            <Stop
              offset={String(SUN / 2 / c)}
              stopColor={colors.feature.sunGlassGold}
              stopOpacity={sunGlassOpacity.glow}
            />
            <Stop offset="1" stopColor={colors.feature.sunGlassGold} stopOpacity={0} />
          </RadialGradient>
          <RadialGradient id="rhemaSunCore" cx="40%" cy="38%" r="60%">
            <Stop offset="0" stopColor={colors.feature.sunGlassLight} stopOpacity={sunGlassOpacity.core} />
            <Stop offset="1" stopColor={colors.feature.sunGlassGold} stopOpacity={sunGlassOpacity.edge} />
          </RadialGradient>
        </Defs>
        <Circle cx={c} cy={c} r={c} fill="url(#rhemaSunGlow)" />
        <Circle
          cx={c}
          cy={c}
          r={SUN / 2 - 0.75}
          fill="url(#rhemaSunCore)"
          stroke={colors.feature.sunGlassLight}
          strokeOpacity={sunGlassOpacity.rim}
          strokeWidth={1.5}
        />
      </Svg>
    </View>
  );
}

// Same spot the solid sun sat in (right 22, top 20), widened by the glow on every side.
const glassSunPosition = { position: 'absolute' as const, right: 22 - GLOW, top: 20 - GLOW };

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
          <AppText variant="mono.meta" style={styles.vineLabel}>
            {weekdayInitial(d)}
          </AppText>
        </View>
      ))}
    </View>
  );
}

const useStyles = createThemedStyles((colors) => ({
  card: {
    borderRadius: 28,
    overflow: 'hidden',
    padding: spacing.xl,
    backgroundColor: colors.feature.bg,
    borderWidth: 1,
    borderColor: colors.feature.border,
  },
  orb: {
    position: 'absolute',
    borderRadius: radius.pill,
  },
  orbBig: {
    width: 200,
    height: 200,
    right: -50,
    top: -60,
    backgroundColor: colors.feature.orbSoft,
    borderWidth: 1,
    borderColor: colors.feature.orbEdge,
  },
  body: {
    gap: spacing.sm + 2,
  },
  eyebrow: {
    color: colors.feature.eyebrow,
    letterSpacing: 1.2,
  },
  title: {
    color: colors.feature.text,
    maxWidth: 210,
  },
  meta: {
    color: colors.feature.muted,
  },
  steps: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 2,
  },
  step: {
    flex: 1,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.feature.track,
  },
  stepDone: {
    backgroundColor: colors.feature.sun,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.xs,
  },
  sun: {
    minHeight: 44,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.pill,
    backgroundColor: colors.sunButton.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sunText: {
    color: colors.sunButton.text,
  },
  pressed: {
    opacity: 0.85,
  },
  garden: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: spacing.sm,
  },
  gardenText: {
    color: colors.feature.text,
  },
  done: {
    borderRadius: 24,
    padding: spacing.lg,
    gap: spacing.sm,
    backgroundColor: colors.status.sage.bg,
  },
  doneTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  check: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.status.sage.text,
  },
  doneText: {
    flex: 1,
  },
  doneTitle: {
    color: colors.status.sage.text,
  },
  doneWord: {
    color: colors.status.sage.text,
    paddingLeft: 48,
  },
  vine: { flexDirection: 'row', justifyContent: 'space-between', paddingTop: spacing.sm },
  vineDay: { alignItems: 'center', gap: spacing.xs },
  vineLabel: { color: colors.status.sage.text },
  leaf: {
    width: 18,
    height: 18,
    borderTopLeftRadius: 9,
    borderBottomRightRadius: 9,
    borderWidth: 1,
    borderColor: colors.status.sage.text,
  },
  leafDone: { backgroundColor: colors.status.sage.text },
  leafToday: { borderWidth: 2 },
}));
