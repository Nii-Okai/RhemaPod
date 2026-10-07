import React from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AppText } from './Text';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';

export interface ActionButtonProps {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  accessibilityLabel: string;
  onPress: () => void;
  selected?: boolean;
}

/**
 * Icon-over-label action button — series detail's action row (Isaac's ask, session
 * 2026-09-30, Netflix's title-page "Set Reminders / My List / Rate / Share" row);
 * promoted here once sermon detail became its second consumer (session 2026-10-01,
 * which also added a third action, Like, alongside My List and Share; series detail
 * later added a fourth, Download — see `app/series/[id].tsx`'s own call site for what
 * it does). My List and Like are client-only toggles (the same pattern `HeroCard`
 * already established and Isaac already confirmed for My List — "will be used for
 * adding to playlist later", no backend field exists for either); Share is React
 * Native's own `Share` API, genuinely functional, no backend needed; Download queues
 * real downloads through `useDownloads()`, same pipeline every other download control
 * in this app uses. Set Reminders and Rate are deliberately not built — there's no
 * reminder scheduling or rating feature anywhere in this codebase (mobile or backend) to
 * wire either to, and a button that does nothing is worse than one that isn't there.
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
 */
export function ActionButton({ icon, label, accessibilityLabel, onPress, selected = false }: ActionButtonProps) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ selected }}
      style={({ pressed }) => [styles.button, pressed && styles.pressed]}
    >
      <Ionicons name={icon} size={ICON_SIZE} color={selected ? colors.accent.gold : colors.text.primary} />
      <AppText variant="ui.actionLabel" tone={selected ? 'gold' : 'secondary'} style={styles.label}>
        {label}
      </AppText>
    </Pressable>
  );
}

const ICON_SIZE = 28;

const styles = StyleSheet.create({
  button: {
    alignItems: 'center',
    gap: spacing.xs,
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
});
