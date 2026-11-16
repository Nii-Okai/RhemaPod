import React from 'react';
import { Pressable, Share, View } from 'react-native';
import * as Speech from 'expo-speech';
import { AppText, PlatformIcon } from '../../../../components';
import { createThemedStyles, useTheme } from '../../../../theme/ThemeContext';
import { radius } from '../../../../theme/radius';
import { spacing } from '../../../../theme/spacing';
import { useVerseOfTheDay } from '../../../../lib/query/hooks/useVerseOfTheDay';

/**
 * Home's opening card (Daybreak redesign, canvas B1/B2): the verse of the day on a warm
 * gold wash (light) or a raised navy card (dark), with Listen (read aloud on the phone)
 * and Share. Same quiet failure as before: nothing renders while loading, on an error, or
 * when the server has no verse.
 */
export function VerseCard() {
  const styles = useStyles();
  const { colors } = useTheme();
  const { data: verse } = useVerseOfTheDay();

  if (!verse) return null;

  // Verses come in as entered in the admin portal, sometimes with hard line breaks and
  // stray spaces mid-sentence (Nii's phone test, 2026-10-21). One flowing line reads right.
  const text = verse.text.replace(/\s+/g, ' ').trim();
  const reference = `${verse.reference} · ${verse.translation.toUpperCase()}`;

  const listen = () => {
    void Speech.isSpeakingAsync()
      .then((speaking) => {
        if (speaking) return Speech.stop();
        Speech.speak(`${text} ${verse.reference}.`);
      })
      .catch(() => undefined);
  };
  const share = () => {
    void Share.share({ message: `“${text}” ${verse.reference} (${verse.translation.toUpperCase()})` }).catch(
      () => undefined,
    );
  };

  return (
    <View style={styles.card}>
      <View style={styles.top}>
        <AppText variant="ui.badge" style={styles.eyebrow}>
          VERSE OF THE DAY
        </AppText>
        <View style={styles.tools}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Listen to the verse"
            onPress={listen}
            hitSlop={spacing.xs}
            style={({ pressed }) => [styles.tool, pressed && styles.pressed]}
          >
            <PlatformIcon name="volume-high-outline" size={18} color={colors.verse.icon} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Share the verse"
            onPress={share}
            hitSlop={spacing.xs}
            style={({ pressed }) => [styles.tool, pressed && styles.pressed]}
          >
            <PlatformIcon name="share-outline" size={18} color={colors.verse.icon} />
          </Pressable>
        </View>
      </View>
      <View accessible accessibilityLabel={`Verse of the day. ${text}. ${verse.reference}, ${verse.translation}`}>
        <AppText variant="display.row">
          “{text}”
        </AppText>
        <AppText variant="mono.meta" style={styles.reference}>
          {reference.toUpperCase()}
        </AppText>
      </View>
    </View>
  );
}

const useStyles = createThemedStyles((colors) => ({
  card: {
    borderRadius: 24,
    paddingHorizontal: spacing.lg + 2,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
    gap: spacing.xs,
    backgroundColor: colors.verse.bg,
    borderWidth: 1,
    borderColor: colors.verse.border,
  },
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  eyebrow: {
    color: colors.verse.eyebrow,
    letterSpacing: 1.2,
  },
  tools: {
    flexDirection: 'row',
    gap: 2,
  },
  tool: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.6,
  },
  reference: {
    color: colors.verse.eyebrow,
    marginTop: spacing.sm,
  },
}));
