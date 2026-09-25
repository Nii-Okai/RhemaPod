import React from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { AppText } from '../Text';
import { colors } from '../../theme/colors';
import { radius } from '../../theme/radius';
import { spacing } from '../../theme/spacing';
import type { AnnouncementListItem } from '../../lib/query/hooks/useAnnouncements';

export interface AnnouncementCardProps {
  announcement: AnnouncementListItem;
}

/**
 * Announcement card (design spec 1k): image, title, summary text, and — for
 * a pinned item — the wheat-notice treatment (`colors.status.wheat`, gold
 * dot + tinted card). P10: built inline here only, never promoted to a
 * shared "notice" component — one confirmed MVP use.
 *
 * `announcement.description` ("short subtitle for list cards" —
 * `Announcement.description`'s own column comment in `app/models/models.py`)
 * is what renders as this card's body text. The list contract
 * (`AnnouncementListItem`) doesn't carry the longer `body` field at all —
 * only the detail/staff reads do — so this isn't a stylistic choice between
 * "body" and "description", it's the only summary text the wire actually
 * has.
 *
 * No date range is rendered here — see `lib/format/announcementDateRange.ts`'s
 * docstring and this slice's `status.md` entry: the list contract has no
 * `expires_at` to format, and fanning out a per-row detail call to backfill
 * it is the fan-out pattern this plan says not to invent.
 */
export function AnnouncementCard({ announcement }: AnnouncementCardProps) {
  const pinned = announcement.pinned;

  return (
    <View style={[styles.card, pinned ? styles.pinnedCard : styles.standardCard]} accessibilityRole="summary">
      {announcement.image_url ? (
        <Image source={{ uri: announcement.image_url }} style={styles.image} />
      ) : null}
      <View style={styles.body}>
        {pinned ? (
          <View style={styles.pinnedRow}>
            <View
              style={styles.pinnedDot}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
            />
            <AppText variant="ui.label" tone="gold" style={styles.pinnedLabel}>
              Pinned
            </AppText>
          </View>
        ) : null}
        <AppText variant="display.compact" numberOfLines={2}>
          {announcement.title}
        </AppText>
        {announcement.description ? (
          <AppText variant="ui.body" tone="secondary" style={styles.summary}>
            {announcement.description}
          </AppText>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    marginBottom: spacing.lg,
  },
  standardCard: {
    backgroundColor: colors.surface.raised,
    borderColor: colors.border.card,
  },
  pinnedCard: {
    backgroundColor: colors.status.wheat.bg,
    borderColor: colors.status.wheat.border,
  },
  image: {
    width: '100%',
    aspectRatio: 16 / 9,
  },
  body: {
    padding: spacing.lg,
    gap: spacing.xs,
  },
  pinnedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginBottom: spacing.xs,
  },
  pinnedDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.status.wheat.dot,
  },
  pinnedLabel: {
    textTransform: 'uppercase',
  },
  summary: {
    marginTop: 0,
  },
});
