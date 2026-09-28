import React from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import { AppText } from '../../../components';
import { colors } from '../../../theme/colors';
import { radius } from '../../../theme/radius';
import { spacing } from '../../../theme/spacing';
import { formatDuration } from '../../../lib/format/duration';
import type { SermonListItem } from '../../../lib/query/hooks/useSermons';

export interface HeroCardProps {
  sermon: SermonListItem;
  onPress: () => void;
}

/** "31:02 · Ada Nwosu" — omits the speaker segment if the card has none. */
function metaLine(sermon: SermonListItem): string {
  const parts = [formatDuration(sermon.duration_seconds), sermon.speaker_name].filter(
    (part): part is string => Boolean(part),
  );
  return parts.join(' · ');
}

/**
 * Home's hero (design spec §3 Home: "full-bleed art, 'New this week' sermon"; plan P5: the
 * hero IS `GET /catalog/sermons`'s first item — server-ordered newest-published-first, no
 * client-side pin). Whole card is the tap target, matching `SermonResultRow`'s
 * whole-row-pressable convention rather than adding a separate CTA the base spec never
 * draws for this screen (unlike the W4.0-addendum detail screen, §8.1.6, which does).
 */
export function HeroCard({ sermon, onPress }: HeroCardProps) {
  const meta = metaLine(sermon);
  const label = meta ? `${sermon.title}, ${meta}` : sermon.title;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
    >
      {sermon.thumbnail_url ? (
        <Image source={{ uri: sermon.thumbnail_url }} style={styles.art} resizeMode="cover" />
      ) : (
        <View style={styles.artFallback} />
      )}
      <View style={styles.body}>
        <AppText variant="ui.label" tone="tertiary" style={styles.eyebrow}>
          New this week
        </AppText>
        <AppText variant="display.hero" numberOfLines={2}>
          {sermon.title}
        </AppText>
        {meta ? (
          <AppText variant="mono.meta" tone="tertiary" style={styles.meta}>
            {meta}
          </AppText>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.xl,
    overflow: 'hidden',
    backgroundColor: colors.surface.raised,
  },
  cardPressed: {
    opacity: 0.7,
  },
  art: {
    width: '100%',
    aspectRatio: 16 / 9,
  },
  artFallback: {
    width: '100%',
    aspectRatio: 16 / 9,
    backgroundColor: colors.surface.sunken,
  },
  body: {
    padding: spacing.lg,
    gap: spacing.xs,
  },
  eyebrow: {
    textTransform: 'uppercase',
  },
  meta: {
    marginTop: spacing.xs,
  },
});
