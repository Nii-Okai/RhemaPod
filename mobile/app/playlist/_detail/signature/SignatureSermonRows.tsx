import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { AppText, FittedArt, PlatformIcon, SwipeToDelete } from '../../../../components';
import { darkColors as onArt } from '../../../../theme/colors';
import { createThemedStyles, useTheme } from '../../../../theme/ThemeContext';
import { radius } from '../../../../theme/radius';
import { spacing } from '../../../../theme/spacing';
import { fontFamily } from '../../../../theme/typography';
import type { PlaylistItemPublic } from '../../../../lib/query/hooks/usePlaylists';
import { leaf } from '../../../(tabs)/_home/signature/leaf';
import { metaLineFor } from '../sermonMeta';
import type { AddableSermon } from '../SermonAddRow';

const ART_WIDTH = 104;
const ADD_ART_WIDTH = 88;
const ART_LEAF = leaf(12, 3);

function Art({ uri, width }: { uri: string | null | undefined; width: number }) {
  const { colors } = useTheme();
  const styles = useStyles();
  return (
    <View style={[styles.art, ART_LEAF, { width }]}>
      {uri ? (
        <FittedArt uri={uri} />
      ) : (
        <PlatformIcon name="musical-notes-outline" size={20} color={colors.text.tertiary} />
      )}
    </View>
  );
}

export interface SignaturePlaylistItemRowProps {
  item: PlaylistItemPublic;
  /** 1-based position in the playlist. */
  position: number;
  onPress: () => void;
  onRemove: () => void;
  isPreviewPlaying: boolean;
  isPreviewLoading: boolean;
  onTogglePreview: () => void;
}

/**
 * One item in a Signature playlist: its position in mono, 16:9 art with the inline
 * preview play/pause chip on it (the same separate hit target as the classic row), the
 * title and a mono "SERIES · EPISODE 2" (or category) line. Swipe left to remove, as before.
 */
export function SignaturePlaylistItemRow({
  item,
  position,
  onPress,
  onRemove,
  isPreviewPlaying,
  isPreviewLoading,
  onTogglePreview,
}: SignaturePlaylistItemRowProps) {
  const styles = useStyles();
  const sermon = item.sermon;
  // Category or series/episode only — no speaker or duration (Isaac's ask, 2026-10-10).
  const meta = metaLineFor(sermon);

  return (
    <SwipeToDelete
      onDelete={onRemove}
      deleteAccessibilityLabel={`Remove ${sermon.title} from this playlist`}
      testID={`playlist-item-row-${item.id}`}
    >
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`Play ${sermon.title}`}
        style={({ pressed }) => [styles.row, styles.itemRow, pressed && styles.pressed]}
      >
        <AppText variant="mono.meta" tone="tertiary" style={styles.position}>
          {String(position).padStart(2, '0')}
        </AppText>
        <View>
          <Art uri={sermon.thumbnail_url} width={ART_WIDTH} />
          <Pressable
            onPress={onTogglePreview}
            accessibilityRole="button"
            accessibilityLabel={isPreviewPlaying ? `Pause preview of ${sermon.title}` : `Preview ${sermon.title}`}
            style={styles.overlay}
          >
            {/* On the art, so pinned to the dark palette like the classic row's chip. */}
            <View style={[styles.chip, isPreviewPlaying && styles.chipPlaying]}>
              {isPreviewLoading ? (
                <ActivityIndicator size="small" color={onArt.text.primary} />
              ) : (
                <PlatformIcon
                  name={isPreviewPlaying ? 'pause' : 'play'}
                  size={14}
                  color={isPreviewPlaying ? onArt.primaryButton.text : onArt.text.primary}
                />
              )}
            </View>
          </Pressable>
        </View>
        <View style={styles.text}>
          <AppText variant="ui.bodyLarge" numberOfLines={2} style={styles.title}>
            {sermon.title}
          </AppText>
          {meta ? (
            <AppText variant="mono.meta" tone="tertiary" numberOfLines={1}>
              {meta.toUpperCase()}
            </AppText>
          ) : null}
        </View>
      </Pressable>
    </SwipeToDelete>
  );
}

export interface SignatureSermonAddRowProps {
  sermon: AddableSermon;
  alreadyAdded?: boolean;
  isDownloaded?: boolean;
  isAdding?: boolean;
  onAdd: () => void;
  onRemove?: () => void;
}

/**
 * A sermon with a trailing add control — the add-to-playlist sheet's results and the
 * playlist's Recommended list. "+" outline to add; once it's in the playlist the circle
 * fills gold with a check (Signature's "it's yours" colour, as on My List), and tapping
 * it removes the item again. A sage check by the meta line still means "downloaded".
 */
export function SignatureSermonAddRow({
  sermon,
  alreadyAdded = false,
  isDownloaded = false,
  isAdding = false,
  onAdd,
  onRemove,
}: SignatureSermonAddRowProps) {
  const { colors } = useTheme();
  const styles = useStyles();
  const meta = metaLineFor(sermon);
  return (
    <Pressable
      onPress={() => (alreadyAdded ? onRemove?.() : onAdd())}
      accessibilityRole="button"
      accessibilityLabel={alreadyAdded ? `Remove ${sermon.title} from this playlist` : `Add ${sermon.title}`}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <Art uri={sermon.thumbnail_url} width={ADD_ART_WIDTH} />
      <View style={styles.text}>
        <AppText variant="ui.bodyLarge" numberOfLines={2} style={styles.title}>
          {sermon.title}
        </AppText>
        {meta || isDownloaded ? (
          <View style={styles.metaRow}>
            {isDownloaded ? <PlatformIcon name="checkmark-circle" size={12} color={colors.status.sage.text} /> : null}
            {meta ? (
              <AppText variant="mono.meta" tone="tertiary" numberOfLines={1}>
                {meta.toUpperCase()}
              </AppText>
            ) : null}
          </View>
        ) : null}
      </View>
      <View style={[styles.action, alreadyAdded && styles.actionDone]}>
        {alreadyAdded ? (
          <PlatformIcon name="checkmark" size={18} color={colors.surface.app} />
        ) : isAdding ? (
          <ActivityIndicator size="small" color={colors.accent.gold} />
        ) : (
          <PlatformIcon name="add" size={20} color={colors.accent.goldText} />
        )}
      </View>
    </Pressable>
  );
}

const useStyles = createThemedStyles((colors) => ({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 72,
    paddingVertical: spacing.sm,
  },
  // Inset inside `SwipeToDelete`'s own raised card.
  itemRow: {
    paddingHorizontal: spacing.md,
  },
  pressed: {
    opacity: 0.7,
  },
  position: {
    width: 18,
  },
  art: {
    aspectRatio: 16 / 9,
    overflow: 'hidden',
    backgroundColor: colors.surface.sunken,
    alignItems: 'center',
    justifyContent: 'center',
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chip: {
    width: 30,
    height: 30,
    borderRadius: radius.pill,
    backgroundColor: onArt.overlay.chipFill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: onArt.overlay.chipBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipPlaying: {
    backgroundColor: onArt.accent.goldText,
    borderColor: onArt.accent.goldText,
  },
  text: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  title: {
    fontFamily: fontFamily.uiSemiBold,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  action: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionDone: {
    backgroundColor: colors.accent.gold,
    borderColor: colors.accent.gold,
  },
}));
