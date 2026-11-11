import React from 'react';
import { Pressable, View } from 'react-native';
import { AppText } from '../../../../components';
import { createThemedStyles } from '../../../../theme/ThemeContext';
import { spacing } from '../../../../theme/spacing';
import { useAnnouncements, type AnnouncementListItem } from '../../../../lib/query/hooks/useAnnouncements';

const SHOWN = 2;
const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

/** The date an announcement is "for": when it went live, else when it was written. */
function dayOf(item: AnnouncementListItem): Date {
  return new Date(item.publish_at ?? item.created_at);
}

export interface ChurchWeekSectionProps {
  onOpenAll: () => void;
}

/**
 * "This week at church" (Daybreak redesign, canvas B1): the newest two announcements
 * (pinned first, in the server's order) as rows with a date chip, and "All news" to the
 * full list. Nothing renders while loading, on an error, or with no announcements: it is
 * a quiet extra on Home, not something to wait for.
 */
export function ChurchWeekSection({ onOpenAll }: ChurchWeekSectionProps) {
  const styles = useStyles();
  const { data } = useAnnouncements();
  const items = (data ?? []).slice(0, SHOWN);
  if (items.length === 0) return null;

  return (
    <View style={styles.section}>
      <View style={styles.head}>
        <AppText variant="display.section" accessibilityRole="header">
          This week at church
        </AppText>
        <Pressable onPress={onOpenAll} accessibilityRole="button" accessibilityLabel="All church news" hitSlop={spacing.md}>
          <AppText variant="ui.label" tone="gold">
            All news
          </AppText>
        </Pressable>
      </View>
      <View style={styles.card}>
        {items.map((item, index) => {
          const day = dayOf(item);
          const valid = !Number.isNaN(day.getTime());
          const meta = item.pinned ? 'Pinned' : item.description?.split('\n')[0]?.trim();
          return (
            <Pressable
              key={item.id}
              onPress={onOpenAll}
              accessibilityRole="button"
              accessibilityLabel={`${item.title}${item.pinned ? ', pinned' : ''}`}
              style={({ pressed }) => [styles.row, index > 0 && styles.rowDivider, pressed && styles.pressed]}
            >
              <View style={[styles.chip, index % 2 === 1 && styles.chipAlt]}>
                <AppText variant="ui.badge" style={index % 2 === 1 ? styles.chipTextAlt : styles.chipText}>
                  {valid ? WEEKDAYS[day.getDay()] : ''}
                </AppText>
                <AppText variant="display.row" style={index % 2 === 1 ? styles.chipTextAlt : styles.chipText}>
                  {valid ? String(day.getDate()) : '·'}
                </AppText>
              </View>
              <View style={styles.text}>
                <AppText variant="ui.bodyBold" numberOfLines={2}>
                  {item.title}
                </AppText>
                {meta ? (
                  <AppText variant="ui.body" tone="tertiary" numberOfLines={1}>
                    {meta}
                  </AppText>
                ) : null}
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const useStyles = createThemedStyles((colors) => ({
  section: {
    gap: spacing.md,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  card: {
    borderRadius: 22,
    backgroundColor: colors.surface.raised,
    borderWidth: 1,
    borderColor: colors.border.default,
    paddingHorizontal: spacing.md + 2,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md + 2,
    paddingVertical: spacing.md + 2,
  },
  rowDivider: {
    borderTopWidth: 1,
    borderTopColor: colors.border.default,
  },
  pressed: {
    opacity: 0.7,
  },
  chip: {
    width: 58,
    height: 62,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.status.slate.bg,
  },
  chipAlt: {
    backgroundColor: colors.status.sage.bg,
  },
  chipText: {
    color: colors.status.slate.text,
  },
  chipTextAlt: {
    color: colors.status.sage.text,
  },
  text: {
    flex: 1,
    gap: 2,
  },
}));
