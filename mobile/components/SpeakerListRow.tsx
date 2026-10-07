import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { AppText } from './Text';
import { Avatar } from './Avatar';
import { spacing } from '../theme/spacing';
import type { Speaker } from '../lib/query/hooks/useSpeakers';

export interface SpeakerListRowProps {
  speaker: Speaker;
  onPress: () => void;
}

/** Verbatim fallback copy — matches the admin portal's speaker row (speaker-row.tsx). */
const NO_BIO_FALLBACK = 'No bio yet';

function countLabel(count: number): string {
  return count === 1 ? '1 sermon' : `${count} sermons`;
}

/** Design spec 1i/2d: avatar chip (P6 hash), name, bio-or-fallback. The sermon count used
 *  to trail each row — dropped from the visible rendering (Isaac's ask, session
 *  2026-10-02) but still reaches VoiceOver via the accessibility label below. */
export function SpeakerListRow({ speaker, onPress }: SpeakerListRowProps) {
  const bio = speaker.bio ?? NO_BIO_FALLBACK;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${speaker.name}, ${bio}, ${countLabel(speaker.sermon_count)}`}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
    >
      <Avatar name={speaker.name} seed={speaker.id} size={40} />
      <View style={styles.textBlock}>
        <AppText variant="display.compact" numberOfLines={1}>
          {speaker.name}
        </AppText>
        <AppText variant="ui.body" tone={speaker.bio ? 'secondary' : 'tertiary'} numberOfLines={1}>
          {bio}
        </AppText>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  rowPressed: {
    opacity: 0.7,
  },
  textBlock: {
    flex: 1,
    gap: spacing.xs,
  },
});
