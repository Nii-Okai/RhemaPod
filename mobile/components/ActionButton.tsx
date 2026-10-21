import React from 'react';
import { Pressable, View } from 'react-native';
import { AppText } from './Text';
import { PlatformIcon, type AppIconName } from './PlatformIcon';
import { PopIn } from './PopIn';
import { createThemedStyles, useTheme } from '../theme/ThemeContext';
import { radius } from '../theme/radius';
import { spacing } from '../theme/spacing';

export interface ActionButtonProps {
  icon: AppIconName;
  label: string;
  accessibilityLabel: string;
  onPress: () => void;
  selected?: boolean;
  /** A notification-style count badge pinned to the icon's top-right corner (Isaac's ask,
   * session 2026-10-09 — Like's own counter, not a second label line). Renders nothing
   * at `0`/`undefined`: a bare icon with no count reads as "unliked", not "0 likes". */
  badgeCount?: number;
}

/**
 * Icon-over-label action button — series detail's action row (Isaac's ask, session
 * 2026-09-30, Netflix's title-page "Set Reminders / My List / Rate / Share" row);
 * promoted here once sermon detail became its second consumer (session 2026-10-01,
 * which also added a third action, Like, alongside My List and Share; series detail
 * later added a fourth, Download — see `app/series/[id].tsx`'s own call site for what
 * it does). My List was a client-only toggle at first (Isaac's own call at the time:
 * "will be used for adding to playlist later") — it's real now (session 2026-10-11),
 * via `useAddToDefaultLibrary` (`usePlaylists.ts`'s own doc comment on the "default
 * playlist" convention): sermon detail adds the one sermon, series detail adds every
 * episode. Like is a real backend toggle too (`liked_by_me`/`like_count`, its own
 * endpoint); Share is React Native's own `Share` API; Download queues real downloads
 * through `useDownloads()`, same pipeline every other download control in this app
 * uses. Set Reminders and Rate are deliberately not built — there's no reminder
 * scheduling or rating feature anywhere in this codebase (mobile or backend) to wire
 * either to, and a button that does nothing is worse than one that isn't there.
 *
 * Icon size (28) matched to Isaac's own Netflix reference screenshot, session
 * 2026-10-01; the row itself (each screen's own `actionRow` style, not this
 * component's) is left-aligned with fixed gaps for 3 items, `space-between` once
 * Download made it 4 — see series detail's own `actionRow` style for why. Label
 * started on `ui.body` (regular, 14), was trimmed to a plain smaller size (12, still
 * regular weight), then — Isaac's follow-up, same session, "reduce it further and bold
 * it" — moved to the dedicated `ui.actionLabel` variant (bold, 11): per `Text.tsx`'s own
 * rule ("never override `fontFamily` at a call site — add a new variant instead"), a
 * bold weight needs a real variant, not a style-prop override. "Bold icon text" meant
 * the literal label text specifically (Isaac's own clarification, same session) — the
 * icon glyphs themselves (`add`/`checkmark`, `heart`/`heart-outline`, `share-outline`,
 * `download-outline`) are unchanged; a same-session detour through solid `share`/
 * `download` glyphs was reverted.
 *
 * `badgeCount` (session 2026-10-09, Like's own real counter): a small gold
 * notification-style badge pinned to the icon's own top-right corner, not a second
 * label line — Isaac's explicit call after an initial "Like\n{N}" two-line label read
 * as "old fashioned". Pops in (`PopIn`) on mount, re-keyed per count so a plain
 * increment re-pops it too, not just its first 0 -> 1 appearance. Hidden entirely at
 * `0`/`undefined` — a bare heart with no badge reads as "unliked", not "0 likes".
 */
export function ActionButton({
  icon,
  label,
  accessibilityLabel,
  onPress,
  selected = false,
  badgeCount,
}: ActionButtonProps) {
  const { colors } = useTheme();
  const styles = useStyles();
  const showBadge = Boolean(badgeCount && badgeCount > 0);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ selected }}
      style={({ pressed }) => [styles.button, pressed && styles.pressed]}
    >
      <View style={styles.iconWrap}>
        <PlatformIcon name={icon} size={ICON_SIZE} color={selected ? colors.accent.gold : colors.text.primary} />
        {showBadge ? (
          // The anchor carries the absolute top-right positioning; `PopIn` wraps the
          // circle itself, one layer further in. `PopIn`'s own `Animated.View` has no
          // size/position of its own, so if `badge` carried `position: 'absolute'`
          // directly, it would be positioned against *that* unstyled wrapper instead of
          // `iconWrap` — which, with no `flexDirection` override, stacks its two
          // children (the icon, then this) in normal flow, landing the badge between
          // the icon and the label below it rather than pinned to the icon's corner.
          <View style={styles.badgeAnchor}>
            {/* Keyed on the count so crossing a digit boundary (9 -> 10) re-pops the
                badge along with a plain increment — not just its first 0 -> 1 appearance. */}
            <PopIn key={badgeCount}>
              <View style={styles.badge}>
                <AppText variant="ui.badge" style={styles.badgeText}>
                  {badgeCount && badgeCount > 99 ? '99+' : badgeCount}
                </AppText>
              </View>
            </PopIn>
          </View>
        ) : null}
      </View>
      <AppText variant="ui.actionLabel" tone={selected ? 'gold' : 'secondary'} style={styles.label}>
        {label}
      </AppText>
    </Pressable>
  );
}

const ICON_SIZE = 28;
const BADGE_MIN_SIZE = 18;

const useStyles = createThemedStyles((colors) => ({
  button: {
    alignItems: 'center',
    gap: spacing.xs,
  },
  iconWrap: {
    width: ICON_SIZE,
    height: ICON_SIZE,
  },
  badgeAnchor: {
    position: 'absolute',
    top: -6,
    right: -10,
  },
  badge: {
    minWidth: BADGE_MIN_SIZE,
    height: BADGE_MIN_SIZE,
    borderRadius: radius.pill,
    paddingHorizontal: 4,
    backgroundColor: colors.accent.gold,
    borderWidth: 2,
    borderColor: colors.surface.app,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    fontSize: 10,
    lineHeight: 12,
    color: colors.surface.app,
  },
  // `textAlign: 'center'` only matters for a two-line label (Download's own
  // "Download\n{N} Episodes", series detail, session 2026-10-01) — harmless no-op for
  // every single-line label.
  label: {
    textAlign: 'center',
  },
  pressed: {
    opacity: 0.7,
  },
}));
