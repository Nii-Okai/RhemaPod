import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { AppText, FittedArt, PlatformIcon, PressableScale } from '../../../../components';
import { darkColors as onArt } from '../../../../theme/colors';
import { radius } from '../../../../theme/radius';
import { spacing } from '../../../../theme/spacing';
import { formatDuration } from '../../../../lib/format/duration';
import { useAddToDefaultLibrary } from '../../../../lib/query/hooks/usePlaylists';
import type { SermonListItem } from '../../../../lib/query/hooks/useSermons';
import { ArtScrim } from './ArtScrim';
import { Flame } from './Flame';
import { LEAF } from './leaf';

export interface SignatureHeroCardProps {
  sermon: SermonListItem;
  onPress: () => void;
}

/**
 * Signature Home's "New this week" hero. The art sits at the top at its own landscape
 * shape (the thumbnails carry their title in the artwork, so a portrait crop would cut
 * it) and fades into a dark panel holding the title, the speaker, and Watch / My List.
 *
 * The whole card is dark in both themes — it is a frame for the art, like the player —
 * so it reads `darkColors` directly. My List is the same default-playlist toggle the
 * classic hero uses (`useAddToDefaultLibrary`).
 */
export function SignatureHeroCard({ sermon, onPress }: SignatureHeroCardProps) {
  const defaultLibrary = useAddToDefaultLibrary();
  const saved = defaultLibrary.isInDefaultLibrary(sermon.id);
  const duration = sermon.duration_seconds ? formatDuration(sermon.duration_seconds) : null;

  return (
    <Pressable onPress={onPress} accessible={false} style={styles.card}>
      <View style={styles.artWrap}>
        {sermon.thumbnail_url ? (
          <FittedArt uri={sermon.thumbnail_url} />
        ) : null}
        <ArtScrim />
        <View style={styles.chip} pointerEvents="none">
          <Flame width={8} fill={onArt.accent.goldText} />
          <AppText variant="ui.badge" style={styles.onArtText}>
            New this week
          </AppText>
        </View>
      </View>

      <View style={styles.panel}>
        <AppText variant="display.hero" style={styles.onArtText} numberOfLines={2}>
          {sermon.title}
        </AppText>
        {sermon.speaker_name ? (
          <AppText variant="ui.body" style={styles.onArtSecondary}>
            {sermon.speaker_name}
          </AppText>
        ) : null}
        <View style={styles.ctaRow}>
          <View style={styles.pillSlot}>
            <PressableScale
              onPress={onPress}
              accessibilityRole="button"
              accessibilityLabel={duration ? `Watch ${sermon.title}, ${duration}` : `Watch ${sermon.title}`}
              style={[styles.pill, styles.watchPill]}
            >
              <PlatformIcon name="play" size={16} color={onArt.primaryButton.text} />
              <AppText variant="ui.button" style={styles.watchText}>
                Watch
              </AppText>
            </PressableScale>
          </View>
          <View style={styles.pillSlot}>
            <PressableScale
              onPress={() => defaultLibrary.toggleSermon(sermon.id)}
              accessibilityRole="button"
              accessibilityLabel={saved ? 'Remove from My List' : 'Add to My List'}
              accessibilityState={{ selected: saved }}
              style={[styles.pill, styles.listPill]}
            >
              {defaultLibrary.isToggling ? (
                <ActivityIndicator size="small" color={onArt.text.primary} />
              ) : (
                <PlatformIcon name={saved ? 'checkmark' : 'add'} size={18} color={onArt.text.primary} />
              )}
              <AppText variant="ui.button" style={styles.onArtText}>
                My List
              </AppText>
            </PressableScale>
          </View>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    ...LEAF,
    overflow: 'hidden',
    backgroundColor: onArt.surface.app,
  },
  artWrap: {
    aspectRatio: 16 / 10,
    backgroundColor: onArt.surface.sunken,
  },
  chip: {
    position: 'absolute',
    top: spacing.lg,
    left: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs + 2,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    borderRadius: radius.pill,
    backgroundColor: onArt.overlay.chipFill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: onArt.overlay.chipBorder,
  },
  panel: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xs,
    paddingBottom: spacing.xl,
    gap: spacing.md,
  },
  onArtText: {
    color: onArt.text.primary,
  },
  onArtSecondary: {
    color: onArt.text.secondary,
  },
  ctaRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingTop: spacing.xs,
  },
  // `PressableScale` sizes its inner animated view, so the flex share goes on a wrapper.
  pillSlot: {
    flex: 1,
  },
  pill: {
    height: 48,
    borderRadius: radius.pill,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  watchPill: {
    backgroundColor: onArt.primaryButton.bg,
  },
  watchText: {
    color: onArt.primaryButton.text,
  },
  listPill: {
    backgroundColor: onArt.overlay.chipFill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: onArt.overlay.chipBorder,
  },
});
