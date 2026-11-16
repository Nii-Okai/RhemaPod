import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, Pressable, Share, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import * as Speech from 'expo-speech';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { AppText, IconButton, PlatformIcon, PrimaryButton } from '../../../components';
import { createThemedStyles, useTheme } from '../../../theme/ThemeContext';
import { radius } from '../../../theme/radius';
import { spacing } from '../../../theme/spacing';
import { displayScale, monoScale, scaledLineHeight } from '../../../theme/typography';
import type { Devotional, JournalEntry } from '../../../lib/devotionals/storage';
import { clock, cleanWord, parseReflection, sameWord, tokenize, verseContaining } from '../../../lib/devotionals/text';

/* Daily Rhema steps (plan-daily-devotional M3–M6). Each step is one calm screen; the
   shell (`DevotionalFlow`) owns progress, navigation and saving. */

type Update = (patch: Partial<Omit<JournalEntry, 'date' | 'devotionalId'>>) => void;

function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let alive = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((v) => alive && setReduce(v));
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduce);
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);
  return reduce;
}

// ── Still ─────────────────────────────────────────────────────────────────────
const BREATH_MS = 4000;

export function StillStep({ dev, onDone }: { dev: Devotional; onDone: () => void }) {
  const styles = useStyles();
  const reduce = useReduceMotion();
  const scale = useRef(new Animated.Value(0.8)).current;
  const [left, setLeft] = useState(dev.still.seconds);
  const [inhale, setInhale] = useState(true);

  useEffect(() => {
    if (reduce) return undefined;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(scale, {
          toValue: 1.15,
          duration: BREATH_MS,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(scale, {
          toValue: 0.8,
          duration: BREATH_MS,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [reduce, scale]);

  useEffect(() => {
    const tick = setInterval(() => setLeft((s) => Math.max(0, s - 1)), 1000);
    const breath = setInterval(() => setInhale((v) => !v), BREATH_MS);
    return () => {
      clearInterval(tick);
      clearInterval(breath);
    };
  }, []);

  const words = inhale ? (dev.still.breath_in ?? 'Breathe in') : (dev.still.breath_out ?? 'Breathe out');
  return (
    <View style={styles.center}>
      <Animated.View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={[styles.breath, { transform: [{ scale }] }]}
      />
      <AppText variant="display.title" style={styles.centerText} accessibilityLiveRegion="polite">
        {words}
      </AppText>
      <AppText variant="mono.meta" tone="tertiary" accessibilityLabel={`${left} seconds left`}>
        {clock(left)}
      </AppText>
      {left === 0 ? (
        <PrimaryButton label="I'm ready" onPress={onDone} />
      ) : (
        <Pressable onPress={onDone} accessibilityRole="button" hitSlop={spacing.md}>
          <AppText variant="ui.label" tone="gold">
            Skip
          </AppText>
        </Pressable>
      )}
    </View>
  );
}

// ── Hear ──────────────────────────────────────────────────────────────────────
function ReadingAudio({ url, duration }: { url: string; duration: number | null }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const player = useAudioPlayer({ uri: url });
  const status = useAudioPlayerStatus(player);
  const total = status.duration > 0 ? status.duration : (duration ?? 0);
  return (
    <View style={styles.reading}>
      <IconButton
        icon={status.playing ? 'pause' : 'play'}
        accessibilityLabel={status.playing ? "Pause the pastor's reading" : "Play the pastor's reading"}
        color={colors.accent.goldText}
        onPress={() => (status.playing ? player.pause() : player.play())}
      />
      <View style={styles.readingBody}>
        <AppText variant="ui.label">Pastor&apos;s reading</AppText>
        <AppText variant="mono.meta" tone="tertiary">
          {clock(status.currentTime)} / {total ? clock(total) : '–:––'}
        </AppText>
      </View>
    </View>
  );
}

function ReadingTts({ text, rate, voice }: { text: string; rate: number; voice: string | null }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const [speaking, setSpeaking] = useState(false);
  useEffect(() => () => void Speech.stop(), []);
  const toggle = () => {
    if (speaking) {
      void Speech.stop();
      setSpeaking(false);
      return;
    }
    setSpeaking(true);
    Speech.speak(text, {
      rate,
      voice: voice ?? undefined,
      onDone: () => setSpeaking(false),
      onStopped: () => setSpeaking(false),
      onError: () => setSpeaking(false),
    });
  };
  return (
    <View style={styles.reading}>
      <IconButton
        icon={speaking ? 'pause' : 'volume-high-outline'}
        accessibilityLabel={speaking ? 'Stop reading aloud' : 'Read the passage aloud'}
        color={colors.accent.goldText}
        onPress={toggle}
      />
      <View style={styles.readingBody}>
        <AppText variant="ui.label">Read aloud</AppText>
        <AppText variant="mono.meta" tone="tertiary">
          Your phone&apos;s voice
        </AppText>
      </View>
    </View>
  );
}

export function HearStep({ dev, entry, update }: { dev: Devotional; entry: JournalEntry | undefined; update: Update }) {
  const styles = useStyles();
  const kept = entry?.word ?? null;
  const passageText = dev.passage.verses.map((v) => v.text).join(' ');
  // Centres the small verse number on the first line of its verse, at any text size.
  const numberTop = Math.round(
    (scaledLineHeight(displayScale.scripture.fontSize, displayScale.scripture.lineHeightRatio) -
      scaledLineHeight(monoScale.meta.fontSize, monoScale.meta.lineHeightRatio)) /
      2,
  );

  const keep = (word: string) => {
    const w = cleanWord(word);
    update({ word: w, wordVerse: verseContaining(dev.passage.verses, w) });
  };

  return (
    <View style={styles.stack}>
      <AppText variant="mono.meta" tone="gold">
        {`${dev.passage.ref} · ${dev.passage.translation}`.toUpperCase()}
      </AppText>
      {dev.reading ? (
        <ReadingAudio url={dev.reading.url} duration={dev.reading.duration_s} />
      ) : dev.reading_fallback === 'tts' && dev.tts ? (
        <ReadingTts text={passageText} rate={dev.tts.rate} voice={dev.tts.voice} />
      ) : null}
      <AppText variant="ui.body" tone="secondary">
        Read slowly. Tap the word that stands out to you.
      </AppText>
      {/* Each verse is its own row with the number hanging in a narrow column, and every
          run inside the verse shares one type style, so the lines keep even, open
          spacing (Nii, 2026-11-12: the passage looked cramped and clipped). */}
      <View style={styles.passage}>
        {dev.passage.verses.map((v, vi) => (
          <View key={vi} style={styles.verseRow}>
            {v.number != null ? (
              <AppText variant="mono.meta" tone="gold" style={[styles.verseNumber, { paddingTop: numberTop }]}>
                {String(v.number)}
              </AppText>
            ) : null}
            <AppText variant="display.scripture" style={styles.verseText}>
              {tokenize(v.text).map((t, ti) =>
                t.word ? (
                  <AppText
                    key={ti}
                    variant="display.scripture"
                    onPress={() => keep(t.text)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: sameWord(t.text, kept) }}
                    style={
                      sameWord(t.text, kept)
                        ? styles.kept
                        : !kept && sameWord(t.text, dev.suggested_word)
                          ? styles.suggested
                          : undefined
                    }
                  >
                    {t.text}
                  </AppText>
                ) : (
                  <AppText key={ti} variant="display.scripture">
                    {t.text}
                  </AppText>
                ),
              )}
            </AppText>
          </View>
        ))}
      </View>
      {kept ? (
        <AppText variant="ui.label" tone="gold" accessibilityLiveRegion="polite">
          {`Your word today: ${kept}`}
        </AppText>
      ) : dev.suggested_word ? (
        <Pressable onPress={() => keep(dev.suggested_word as string)} accessibilityRole="button">
          <AppText variant="ui.body" tone="secondary">
            {'Nothing standing out? Keep '}
            <AppText variant="ui.bodyBold" tone="gold">{`"${dev.suggested_word}"`}</AppText>
          </AppText>
        </Pressable>
      ) : null}
    </View>
  );
}

// ── Ponder ────────────────────────────────────────────────────────────────────
export function PonderStep({ dev }: { dev: Devotional }) {
  const styles = useStyles();
  const router = useRouter();
  const { colors } = useTheme();
  return (
    <View style={styles.stack}>
      {parseReflection(dev.reflection_md).map((b, i) => (
        <AppText key={i} variant="ui.bodyLarge" style={b.kind === 'quote' ? styles.quote : undefined}>
          {b.spans.map((s, j) => (
            <AppText
              key={j}
              variant={s.bold ? 'ui.bodyBold' : 'ui.bodyLarge'}
              style={s.italic || b.kind === 'quote' ? styles.italic : undefined}
            >
              {s.text}
            </AppText>
          ))}
        </AppText>
      ))}
      {dev.author ? (
        <AppText variant="mono.meta" tone="tertiary">
          {`— ${dev.author.name}`}
        </AppText>
      ) : null}
      {dev.moment ? (
        <Pressable
          style={styles.moment}
          accessibilityRole="button"
          accessibilityLabel={`Watch the moment from ${dev.moment.title}, ${clock(dev.moment.start_s)} to ${clock(dev.moment.end_s)}`}
          onPress={() =>
            router.push({
              pathname: '/player/[id]',
              params: { id: dev.moment!.sermon_id, startAt: String(dev.moment!.start_s) },
            })
          }
        >
          <PlatformIcon name="play" size={20} color={colors.accent.goldText} />
          <View style={styles.readingBody}>
            <AppText variant="ui.label">From the sermon</AppText>
            <AppText variant="ui.body" tone="secondary" numberOfLines={1}>
              {dev.moment.title}
            </AppText>
            <AppText variant="mono.meta" tone="tertiary">
              {`${clock(dev.moment.start_s)} – ${clock(dev.moment.end_s)}`}
            </AppText>
          </View>
        </Pressable>
      ) : null}
    </View>
  );
}

// ── Pray ──────────────────────────────────────────────────────────────────────
export function PrayStep({ dev, entry, update }: { dev: Devotional; entry: JournalEntry | undefined; update: Update }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const [text, setText] = useState(entry?.journal ?? '');
  const [name, setName] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdUp = entry?.holdUp ?? [];

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const onText = (t: string) => {
    setText(t);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => update({ journal: t }), 500);
  };
  const addName = () => {
    const n = name.trim();
    if (!n || holdUp.includes(n)) return;
    update({ holdUp: [...holdUp, n] });
    setName('');
  };

  return (
    <View style={styles.stack}>
      <AppText variant="display.title" accessibilityRole="header">
        {dev.pray.question}
      </AppText>
      <TextInput
        value={text}
        onChangeText={onText}
        onBlur={() => update({ journal: text })}
        multiline
        placeholder="Write freely. This stays on your phone."
        placeholderTextColor={colors.text.tertiary}
        accessibilityLabel="Journal"
        style={styles.journal}
      />
      <AppText variant="ui.label" tone="secondary">
        Hold someone up
      </AppText>
      <View style={styles.row}>
        <TextInput
          value={name}
          onChangeText={setName}
          onSubmitEditing={addName}
          returnKeyType="done"
          placeholder="A name"
          placeholderTextColor={colors.text.tertiary}
          accessibilityLabel="Name to pray for"
          style={[styles.input, styles.flex]}
        />
        <IconButton icon="add" accessibilityLabel="Add name" onPress={addName} color={colors.accent.goldText} />
      </View>
      {holdUp.length ? (
        <View style={styles.chips}>
          {holdUp.map((n) => (
            <Pressable
              key={n}
              style={styles.chip}
              accessibilityRole="button"
              accessibilityLabel={`Remove ${n}`}
              onPress={() => update({ holdUp: holdUp.filter((x) => x !== n) })}
            >
              <AppText variant="ui.badge">{n}</AppText>
              <PlatformIcon name="close" size={14} color={colors.text.tertiary} />
            </Pressable>
          ))}
        </View>
      ) : null}
      <View style={styles.prayer}>
        <AppText variant="mono.meta" tone="gold">
          PRAY
        </AppText>
        <AppText variant="ui.bodyLarge">{dev.pray.text}</AppText>
      </View>
    </View>
  );
}

// ── Carry ─────────────────────────────────────────────────────────────────────
export function CarryStep({
  dev,
  entry,
  onGarden,
}: {
  dev: Devotional;
  entry: JournalEntry | undefined;
  onGarden: () => void;
}) {
  const styles = useStyles();
  const word = entry?.word ?? dev.suggested_word;
  const verse = entry?.wordVerse;
  return (
    <View style={styles.center}>
      <AppText variant="mono.meta" tone="gold">
        CARRY THIS INTO YOUR DAY
      </AppText>
      {word ? (
        <AppText variant="display.hero" tone="gold" style={styles.centerText}>
          {word}
        </AppText>
      ) : null}
      {verse ? (
        <AppText variant="display.compact" style={styles.centerText}>
          {`"${verse}"`}
        </AppText>
      ) : null}
      <AppText variant="mono.meta" tone="tertiary">
        {(dev.carry_verse_ref || dev.passage.ref).toUpperCase()}
      </AppText>
      <View style={styles.row}>
        <Pressable
          accessibilityRole="button"
          onPress={() =>
            void Share.share({
              message: `${word ? `${word}\n\n` : ''}${verse ? `"${verse}"\n` : ''}${dev.carry_verse_ref || dev.passage.ref}`,
            })
          }
          hitSlop={spacing.md}
        >
          <AppText variant="ui.label" tone="gold">
            Share
          </AppText>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={onGarden} hitSlop={spacing.md}>
          <AppText variant="ui.label" tone="gold">
            Word garden
          </AppText>
        </Pressable>
      </View>
    </View>
  );
}

const useStyles = createThemedStyles((colors) => ({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.xl, paddingVertical: spacing.xxl },
  centerText: { textAlign: 'center' },
  breath: {
    width: 180,
    height: 180,
    borderRadius: radius.pill,
    backgroundColor: colors.chip.square,
    borderWidth: 1,
    borderColor: colors.accent.gold,
  },
  stack: { gap: spacing.lg },
  passage: {
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  verseRow: { flexDirection: 'row', gap: spacing.sm + 2 },
  verseNumber: { minWidth: 18, textAlign: 'right' },
  verseText: { flex: 1 },
  kept: { color: colors.accent.goldText, textDecorationLine: 'underline' },
  suggested: { textDecorationLine: 'underline', textDecorationStyle: 'dotted' },
  reading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surface.raised,
    borderWidth: 1,
    borderColor: colors.border.default,
  },
  readingBody: { flex: 1, gap: 2 },
  quote: { borderLeftWidth: 2, borderLeftColor: colors.accent.gold, paddingLeft: spacing.md },
  italic: { fontStyle: 'italic' },
  moment: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surface.raised,
    borderWidth: 1,
    borderColor: colors.border.card,
  },
  journal: {
    minHeight: 140,
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surface.raised,
    borderWidth: 1,
    borderColor: colors.border.default,
    color: colors.text.primary,
    textAlignVertical: 'top',
    fontSize: 16,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.xl },
  flex: { flex: 1 },
  input: {
    height: 44,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface.raised,
    borderWidth: 1,
    borderColor: colors.border.default,
    color: colors.text.primary,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    minHeight: 32,
    borderRadius: radius.pill,
    backgroundColor: colors.chip.square,
  },
  prayer: {
    gap: spacing.sm,
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.surface.sunken,
  },
}));
