import React from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, View } from 'react-native';
import { AppText, PlatformIcon, PressableScale } from '../../../components';
import { darkColors as onArt } from '../../../theme/colors';
import { createThemedStyles } from '../../../theme/ThemeContext';
import { radius } from '../../../theme/radius';
import { spacing } from '../../../theme/spacing';
import { formatDuration } from '../../../lib/format/duration';
import { useAddToDefaultLibrary } from '../../../lib/query/hooks/usePlaylists';
import type { SermonListItem } from '../../../lib/query/hooks/useSermons';

export interface HeroCardProps {
  sermon: SermonListItem;
  onPress: () => void;
  /** Extra top offset for the eyebrow chip, on top of its own `spacing.md` — clears
      the overlaid, scroll-fading `HomeTopBar` (Isaac's ask, session 2026-09-30) when
      the hero renders underneath it. Defaults to 0 for any other caller. */
  topInset?: number;
}

/**
 * Home's hero (design spec §3 Home: "full-bleed art, 'New this week' sermon"; plan P5: the
 * hero IS `GET /catalog/sermons`'s first item — server-ordered newest-published-first, no
 * client-side pin).
 *
 * Structurally split into an art region and a footer, not one continuous overlay surface.
 * Isaac's later reference (a church media app's own hero) overlays its title/meta directly
 * on the art too — but that art was custom-designed with a reserved, uncluttered gradient
 * area at the bottom specifically for that overlay. Our actual sermon thumbnails are flat
 * title-card graphics with baked-in text running edge-to-edge (verified against the real
 * "Understanding the Prophetic" thumbnail in testing) — there's no safe area to overlay free
 * text onto without covering something. So the only things that sit on the art are
 * self-contained, opaque-background controls that can survive any thumbnail: the eyebrow
 * chip, the play button, and — pulled up on a negative margin to straddle the art's bottom
 * edge — the Watch/My List row. That row reads as part of the hero rather than a
 * disconnected row bolted on below it, while still not being flush against the card's own
 * bottom edge (its own bottom padding keeps the gap). No meta line or separate title renders
 * anywhere — duration is already in the Watch label, and the art already carries the title.
 *
 * The outer tap target is `accessible={false}` — with three real buttons (the play circle,
 * Watch, My List) now present, wrapping the whole card in its own `accessibilityRole=
 * "button"` would make VoiceOver/TalkBack announce one opaque "button" over three more, all
 * describing overlapping actions. Sighted users still get "tap anywhere to open," but the
 * accessible surface is the explicit controls, not the whole card.
 *
 * "My List" is a real playlist now (Isaac's ask, session 2026-10-11: "add sermon to
 * default library" — this was a local `useState` toggle before, doing nothing past a
 * remount; see `useAddToDefaultLibrary`'s own doc comment for the "default" convention).
 * Once added, the circle shows a checkmark — tapping it again removes the sermon
 * (Isaac's ask, session 2026-10-11: "allow user toggle"; it was a one-way add-only
 * button the one session prior).
 */
export function HeroCard({ sermon, onPress, topInset = 0 }: HeroCardProps) {
  const styles = useStyles();
  const defaultLibrary = useAddToDefaultLibrary();
  const saved = defaultLibrary.isInDefaultLibrary(sermon.id);
  const duration = formatDuration(sermon.duration_seconds);
  const watchLabel = duration ? `Watch, ${duration}` : 'Watch';

  return (
    <Pressable
      onPress={onPress}
      accessible={false}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <View style={styles.artWrap}>
        {sermon.thumbnail_url ? (
          <Image source={{ uri: sermon.thumbnail_url }} style={styles.art} resizeMode="cover" />
        ) : (
          <View style={styles.artFallback} />
        )}

        <View style={[styles.eyebrowChip, { top: spacing.md + topInset }]} pointerEvents="none">
          <AppText variant="ui.label" style={styles.onArtText}>
            New this week
          </AppText>
        </View>

        <View style={styles.playButtonWrap} pointerEvents="none">
          <View style={styles.playButton}>
            <PlatformIcon name="play" size={26} color={onArt.text.primary} />
          </View>
        </View>
      </View>

      <View style={styles.ctaRow}>
        <PressableScale
          onPress={onPress}
          accessibilityRole="button"
          accessibilityLabel={watchLabel}
          style={styles.watchPill}
        >
          <PlatformIcon name="play" size={15} color={onArt.primaryButton.text} />
          <AppText variant="ui.button" style={styles.watchPillText}>
            Watch{duration ? ` · ${duration}` : ''}
          </AppText>
        </PressableScale>

        <PressableScale
          onPress={() => defaultLibrary.toggleSermon(sermon.id)}
          accessibilityRole="button"
          accessibilityLabel={saved ? 'Remove from My List' : 'Add to My List'}
          accessibilityState={{ selected: saved }}
          style={styles.savedCircle}
        >
          {defaultLibrary.isToggling ? (
            <ActivityIndicator size="small" color={onArt.text.primary} />
          ) : (
            <PlatformIcon name={saved ? 'checkmark' : 'add'} size={20} color={onArt.text.primary} />
          )}
        </PressableScale>
      </View>
    </Pressable>
  );
}

const useStyles = createThemedStyles((colors) => ({
  card: {
    borderRadius: radius.sm,
    overflow: 'hidden',
    backgroundColor: colors.surface.raised,
  },
  pressed: {
    opacity: 0.9,
  },
  artWrap: {
    aspectRatio: 4 / 3,
  },
  art: {
    ...StyleSheet.absoluteFillObject,
  },
  artFallback: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.surface.sunken,
  },
  eyebrowChip: {
    position: 'absolute',
    left: spacing.md,
    backgroundColor: colors.overlay.chipFill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.overlay.chipBorder,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  playButtonWrap: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playButton: {
    width: 64,
    height: 64,
    borderRadius: radius.pill,
    backgroundColor: colors.overlay.chipFill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.overlay.chipBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
    // Pulls the row up to straddle the art's bottom edge — opaque pills, so (unlike free
    // text) they're safe to overlay on the art and read as part of the hero rather than a
    // disconnected row bolted on below it. `paddingBottom` above is what keeps the row from
    // reading as pinned to the card's own bottom edge.
    marginTop: -22,
  },
  // Everything drawn ON the sermon art keeps the dark palette's light-on-dark colours in
  // both themes: the theme changes the chrome, not the brightness of the artwork.
  onArtText: {
    color: onArt.text.primary,
  },
  watchPillText: {
    color: onArt.primaryButton.text,
  },
  watchPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    // On the art, not on chrome: the light pill in both themes (Isaac's decision,
    // light-mode review §4.2) — a theme-following dark pill would vanish on dark art.
    backgroundColor: onArt.primaryButton.bg,
    borderRadius: radius.pill,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
  },
  savedCircle: {
    width: 44,
    height: 44,
    marginLeft: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.overlay.chipFill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.overlay.chipBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
}));
