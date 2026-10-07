import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AppText, Avatar } from '../../../components';
import { colors } from '../../../theme/colors';
import { radius } from '../../../theme/radius';
import { spacing } from '../../../theme/spacing';
import { formatRelativeTime } from '../../../lib/format/relativeTime';
import type { CommentPublic } from '../../../lib/query/hooks/useComments';

export interface CommentRowProps {
  comment: CommentPublic;
  /** Divider under the row (omitted on the last one). */
  showDivider: boolean;
  onReport: (comment: CommentPublic) => void;
  onBlock: (comment: CommentPublic) => void;
  onDelete: (comment: CommentPublic) => void;
}

/**
 * One comment (design spec §2.2/§2.3). Three shapes:
 * - another viewer's comment: name, time, plain-text body, Report and Block one tap away;
 * - the viewer's own VISIBLE comment: same, with Delete in place of Report/Block;
 * - the viewer's own HIDDEN comment: the body is never shown. It renders from `status` +
 *   `hidden_label` as a notice (under review / removed by a moderator) with no actions —
 *   the server answers a delete of a HIDDEN comment with 409, so none is offered.
 * The body is a plain `Text` with no link detection (links are rejected server-side, and
 * must never be tappable if one slipped through).
 */
export function CommentRow({ comment, showDivider, onReport, onBlock, onDelete }: CommentRowProps) {
  const name = comment.author_display_name;
  const time = formatRelativeTime(comment.created_at);
  const hidden = comment.is_mine && comment.status === 'HIDDEN';

  if (hidden) {
    const moderator = comment.hidden_label === 'removed_by_moderator';
    const tint = moderator ? styles.noticeRose : styles.noticeWheat;
    return (
      <View style={[styles.hiddenWrap]}>
        <View style={[styles.notice, tint]} accessible accessibilityLabel={`${name}, ${time}. ${moderator ? 'Removed by a moderator.' : 'Under review. This comment is hidden while we check it.'}`}>
          <Ionicons
            name={moderator ? 'remove-circle-outline' : 'time-outline'}
            size={14}
            color={moderator ? colors.status.rose.text : colors.status.wheat.dot}
          />
          <View style={styles.noticeText}>
            <View style={styles.metaLine}>
              <AppText variant="ui.label">{name}</AppText>
              <AppText variant="mono.meta" tone="tertiary">
                {time}
              </AppText>
            </View>
            <AppText variant="ui.body" tone={moderator ? 'primary' : 'secondary'} style={moderator ? styles.roseText : undefined}>
              {moderator ? 'Removed by a moderator.' : 'Under review. This comment is hidden while we check it.'}
            </AppText>
          </View>
        </View>
      </View>
    );
  }

  const actions = comment.is_mine
    ? [{ name: 'delete', label: 'Delete your comment' }]
    : [
        { name: 'report', label: `Report comment by ${name}` },
        { name: 'block', label: `Block ${name}` },
      ];

  return (
    <View style={[styles.row, showDivider && styles.divider]}>
      {/* The row's combined label already carries the name; the avatar's own label would
          make a screen reader announce it twice. */}
      <View importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        <Avatar name={name} seed={name} size={38} />
      </View>
      <View style={styles.column}>
        <View
          accessible
          accessibilityLabel={`${name}, ${time}. ${comment.body}`}
          accessibilityActions={actions}
          onAccessibilityAction={(event) => {
            const action = event.nativeEvent.actionName;
            if (action === 'report') onReport(comment);
            if (action === 'block') onBlock(comment);
            if (action === 'delete') onDelete(comment);
          }}
          style={styles.content}
        >
          <View style={styles.metaLine}>
            <AppText variant="ui.label">{name}</AppText>
            <AppText variant="mono.meta" tone="tertiary" accessibilityLabel={`Posted ${time}`}>
              {time}
            </AppText>
          </View>
          <AppText variant="ui.body" selectable={false}>
            {comment.body}
          </AppText>
        </View>
        <View style={styles.actions}>
          {comment.is_mine ? (
            <ActionLink icon="trash-outline" label="Delete" accessibilityLabel="Delete your comment" onPress={() => onDelete(comment)} />
          ) : (
            <>
              <ActionLink icon="flag-outline" label="Report" accessibilityLabel={`Report comment by ${name}`} onPress={() => onReport(comment)} />
              <ActionLink icon="ban-outline" label="Block" accessibilityLabel={`Block ${name}`} onPress={() => onBlock(comment)} />
            </>
          )}
        </View>
      </View>
    </View>
  );
}

interface ActionLinkProps {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  accessibilityLabel: string;
  onPress: () => void;
}

function ActionLink({ icon, label, accessibilityLabel, onPress }: ActionLinkProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={({ pressed }) => [styles.action, pressed && styles.pressed]}
    >
      <Ionicons name={icon} size={14} color={colors.text.tertiary} />
      <AppText variant="ui.badge" tone="tertiary">
        {label}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  divider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border.default,
  },
  column: {
    flex: 1,
    gap: 2,
  },
  content: {
    gap: 2,
  },
  metaLine: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: spacing.sm,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.lg,
  },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minHeight: 44,
  },
  pressed: {
    opacity: 0.7,
  },
  hiddenWrap: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  notice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  noticeWheat: {
    backgroundColor: colors.status.wheat.bg,
    borderColor: colors.status.wheat.border,
  },
  noticeRose: {
    backgroundColor: colors.status.rose.bg,
    borderColor: colors.status.rose.border,
  },
  noticeText: {
    flex: 1,
    gap: 2,
  },
  roseText: {
    color: colors.status.rose.text,
  },
});
