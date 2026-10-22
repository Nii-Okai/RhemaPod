import React, { useEffect, useRef, useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { AppText } from '../../../../components';
import { darkColors as onArt } from '../../../../theme/colors';
import { spacing } from '../../../../theme/spacing';
import type { UpcomingSermon } from '../../../../lib/query/hooks/useUpcomingSermon';
import { ArtScrim } from './ArtScrim';
import { countdownParts, pad2, releaseLabel } from './countdown';
import { LEAF } from './leaf';

export interface CountdownCardProps {
  sermon: UpcomingSermon;
  /** Called once when the countdown reaches zero, so the screen can refetch. */
  onReleased: () => void;
}

const TICK_MS = 30 * 1000;

/**
 * "Next message": the soonest scheduled sermon and a days / hours / minutes countdown to
 * its release. The sermon's own cover art sits on top, whole and uncovered (it carries
 * its title in the artwork), fading into a dark panel with the countdown — the same
 * shape as the hero. Without art, the congregation photo from onboarding stands in.
 * Dark in both themes. Re-renders every 30 seconds; at zero it hands back to the screen, whose
 * refetch picks up the next scheduled sermon (or hides the card).
 */
export function CountdownCard({ sermon, onReleased }: CountdownCardProps) {
  const [now, setNow] = useState(() => new Date());
  const target = new Date(sermon.publish_at);
  const parts = countdownParts(target, now);

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), TICK_MS);
    return () => clearInterval(id);
  }, []);

  // Fire once per release, not on every tick after it.
  const released = useRef(false);
  useEffect(() => {
    if (parts || released.current) return;
    released.current = true;
    onReleased();
  });

  if (!parts) return null;

  const units: Array<[number, string]> = [
    [parts.days, 'DAYS'],
    [parts.hours, 'HRS'],
    [parts.minutes, 'MIN'],
  ];
  const spoken = `${parts.days} days ${parts.hours} hours ${parts.minutes} minutes to go`;

  return (
    <View
      style={styles.card}
      accessible
      accessibilityLabel={`Next message, ${releaseLabel(target)}: ${sermon.title}. ${spoken}`}
    >
      <View style={styles.art}>
        <Image
          testID="countdown-art"
          source={sermon.thumbnail_url ? { uri: sermon.thumbnail_url } : require('../../../../assets/onboarding-1.jpg')}
          style={StyleSheet.absoluteFill}
          resizeMode="cover"
        />
        <ArtScrim height="35%" />
      </View>
      <View style={styles.body}>
        <View style={styles.heading}>
          <AppText variant="ui.badge" style={styles.gold}>
            {`Next message · ${releaseLabel(target)}`}
          </AppText>
          <AppText variant="display.title" style={styles.title} numberOfLines={2}>
            {sermon.title}
          </AppText>
        </View>
        <View style={styles.units}>
          {units.map(([value, label]) => (
            <View key={label}>
              <AppText variant="mono.counter" style={styles.number}>
                {pad2(value)}
              </AppText>
              <AppText variant="mono.meta" style={styles.unitLabel}>
                {label}
              </AppText>
            </View>
          ))}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    ...LEAF,
    overflow: 'hidden',
    backgroundColor: onArt.surface.app,
  },
  art: {
    aspectRatio: 16 / 9,
    backgroundColor: onArt.surface.sunken,
  },
  body: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xs,
    paddingBottom: spacing.xl,
    gap: spacing.lg,
  },
  heading: {
    gap: spacing.xs,
  },
  gold: {
    color: onArt.accent.goldText,
  },
  title: {
    color: onArt.text.primary,
  },
  units: {
    flexDirection: 'row',
    gap: spacing.lg,
  },
  number: {
    color: onArt.text.primary,
  },
  unitLabel: {
    color: onArt.text.secondary,
  },
});
