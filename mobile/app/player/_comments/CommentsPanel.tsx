import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText, ConfirmDialog, LinkButton, PlatformIcon, SkeletonBlock } from '../../../components';
import { createThemedStyles, useTheme } from '../../../theme/ThemeContext';
import { radius } from '../../../theme/radius';
import { spacing } from '../../../theme/spacing';
import { previewDisplayName } from '../../../lib/format/displayName';
import { useIsOnline } from '../../../lib/hooks/useIsOnline';
import { hasSeenAppearAsNotice, markAppearAsNoticeSeen } from '../../../lib/settings/commentsNotice';
import {
  flattenComments,
  useBlockAuthor,
  useDeleteComment,
  usePostComment,
  useReportComment,
  useSermonComments,
  type CommentPublic,
  type CommentReportReason,
} from '../../../lib/query/hooks/useComments';
import { useUnblock } from '../../../lib/query/hooks/useBlocks';
import { useCurrentUser } from '../../../lib/query/hooks/useProfile';
import { AppearAsNotice } from './AppearAsNotice';
import { CommentComposer } from './CommentComposer';
import { CommentRow } from './CommentRow';
import { NamePrompt } from './NamePrompt';
import { ReportSheet } from './ReportSheet';
import { TermsSheet } from './TermsSheet';
import { LEAF } from '../../(tabs)/_home/signature/leaf';
import { isForbidden, postErrorMessage, reportErrorMessage } from './commentErrors';

/** How long a transient confirmation (reported / error) stays up before auto-hiding. */
export const MESSAGE_MS = 4000;

type Prompt = 'name' | 'terms' | 'editName' | null;

type PanelMessage =
  | { kind: 'reported' }
  | { kind: 'blocked'; name: string; blockId: string | null }
  | { kind: 'error'; text: string };

export interface CommentsPanelProps {
  sermonId: string;
  /**
   * `'signature'` (Signature player): a leaf-cornered card inset from the screen edges,
   * with a serif "Comments" heading and a mono count. The screen's toolbar sits below it
   * and owns the bottom safe-area inset, so the composer doesn't pad for it.
   */
  variant?: 'classic' | 'signature';
}

/**
 * The comments section under the player (design spec §2, plan §A.8): a "{n} comments"
 * header with no sort control (newest first is the only order), the thread, and the
 * composer pinned underneath. Offline it renders "Comments unavailable offline" in place of
 * both and never touches playback. The screen above wraps this in a `KeyboardAvoidingView`.
 *
 * Gating before a first post — a name, then the guidelines — is pre-checked from `/auth/me`;
 * the server's 403 is the backstop and re-reads the profile to reopen whichever prompt
 * applies. The draft lives in the composer, so it survives both prompts.
 */
export function CommentsPanel({ sermonId, variant = 'classic' }: CommentsPanelProps) {
  const { colors } = useTheme();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const signature = variant === 'signature';
  const panelStyle = signature ? [styles.panel, styles.signaturePanel] : styles.panel;
  const online = useIsOnline();
  const profile = useCurrentUser();
  const comments = useSermonComments(sermonId, { enabled: online });
  const post = usePostComment(sermonId);
  const del = useDeleteComment(sermonId);
  const report = useReportComment(sermonId);
  const block = useBlockAuthor(sermonId);
  const unblock = useUnblock();

  const [prompt, setPrompt] = useState<Prompt>(null);
  const [reportTarget, setReportTarget] = useState<CommentPublic | null>(null);
  const [blockTarget, setBlockTarget] = useState<CommentPublic | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CommentPublic | null>(null);
  const [message, setMessage] = useState<PanelMessage | null>(null);
  const [postError, setPostError] = useState<string | null>(null);
  const listRef = useRef<FlatList<CommentPublic>>(null);
  const reportedRef = useRef(false);

  const user = profile.data;
  const fullName = (user?.full_name ?? '').trim();
  const needsName = user ? fullName.length === 0 : false;
  const needsTerms = user ? !user.comments_terms_accepted_at : false;
  const publicName = previewDisplayName(fullName);

  // One-time "You'll appear as" notice — per user, per device.
  const [noticeSeen, setNoticeSeen] = useState<boolean | null>(null);
  const userId = user?.id;
  useEffect(() => {
    if (!userId) return;
    let active = true;
    hasSeenAppearAsNotice(userId)
      .then((seen) => active && setNoticeSeen(seen))
      .catch(() => {
        // Unreadable storage must not block commenting; fall back to "not seen" — worst
        // case the notice shows again, same reasoning as commentsNotice.ts's own catch.
        if (active) setNoticeSeen(false);
      });
    return () => {
      active = false;
    };
  }, [userId]);
  const dismissNotice = useCallback(() => {
    setNoticeSeen(true);
    if (userId) void markAppearAsNoticeSeen(userId);
  }, [userId]);

  useEffect(() => {
    if (!message) return;
    // A "blocked" message carries the Undo action — 4s is too short for screen-reader or
    // motor-impaired users to react, so it stays up until the user acts (Undo, which calls
    // setMessage(null) itself) or another action replaces it. Only "reported"/"error" are
    // plain confirmations and auto-hide.
    if (message.kind === 'blocked') return;
    const timer = setTimeout(() => setMessage(null), MESSAGE_MS);
    return () => clearTimeout(timer);
  }, [message]);

  const gate = (): boolean => {
    if (needsName) {
      setPrompt('name');
      return true;
    }
    if (needsTerms) {
      setPrompt('terms');
      return true;
    }
    return false;
  };

  const submitComment = async (body: string): Promise<boolean> => {
    setPostError(null);
    try {
      await post.mutateAsync(body);
      dismissNotice();
      listRef.current?.scrollToOffset({ offset: 0, animated: true });
      return true;
    } catch (error) {
      if (isForbidden(error)) {
        // Backstop: the pre-check was stale or the account state changed. Re-read the
        // profile and reopen the prompt that applies.
        const fresh = (await profile.refetch()).data;
        if (fresh && !(fresh.full_name ?? '').trim()) setPrompt('name');
        else if (fresh && !fresh.comments_terms_accepted_at) setPrompt('terms');
        else setPostError("You can't comment on this sermon.");
        return false;
      }
      setPostError(postErrorMessage(error));
      return false;
    }
  };

  const submitReport = async (reason: CommentReportReason, detail?: string) => {
    if (!reportTarget) return;
    await report.mutateAsync({ commentId: reportTarget.id, reason, detail });
    reportedRef.current = true;
  };

  const closeReport = () => {
    if (reportedRef.current) setMessage({ kind: 'reported' });
    reportedRef.current = false;
    setReportTarget(null);
  };

  const confirmBlock = () => {
    const target = blockTarget;
    if (!target) return;
    setBlockTarget(null);
    block.mutate(
      { commentId: target.id, authorDisplayName: target.author_display_name },
      {
        onSuccess: (result) =>
          setMessage({ kind: 'blocked', name: target.author_display_name, blockId: result.id ?? null }),
        onError: () => setMessage({ kind: 'error', text: "Couldn't block. Try again." }),
      },
    );
  };

  const confirmDelete = () => {
    const target = deleteTarget;
    if (!target) return;
    setDeleteTarget(null);
    del.mutate(target.id, {
      onError: () => setMessage({ kind: 'error', text: "Couldn't delete. Try again." }),
    });
  };

  const undoBlock = (blockId: string) => {
    setMessage(null);
    unblock.mutate(blockId, {
      onError: () => setMessage({ kind: 'error', text: "Couldn't undo. Unblock them in Me, Blocked users." }),
    });
  };

  if (!online) {
    return (
      <View style={[panelStyle, styles.centered]}>
        <View accessibilityLiveRegion="polite" style={styles.offline}>
          <PlatformIcon name="cloud-offline-outline" size={28} color={colors.text.tertiary} />
          <AppText variant="ui.body" tone="secondary">
            Comments unavailable offline
          </AppText>
        </View>
      </View>
    );
  }

  const { items, total } = flattenComments(comments.data);

  const footer = comments.isFetchNextPageError ? (
    <View style={styles.footer}>
      <AppText variant="ui.badge" tone="tertiary">
        Couldn't load more.
      </AppText>
      <LinkButton label="Retry" onPress={() => void comments.fetchNextPage()} />
    </View>
  ) : comments.isFetchingNextPage ? (
    <View style={styles.footer}>
      <ActivityIndicator color={colors.text.tertiary} />
    </View>
  ) : null;

  let body: React.ReactNode;
  if (comments.isLoading) {
    body = (
      <View accessibilityRole="progressbar" accessibilityLabel="Loading comments" style={styles.skeletons}>
        {[0, 1, 2].map((i) => (
          <View key={i} style={styles.skeletonRow}>
            <SkeletonBlock width={38} height={38} radiusToken="pill" />
            <View style={styles.skeletonLines}>
              <SkeletonBlock width="40%" height={12} />
              <SkeletonBlock height={12} />
            </View>
          </View>
        ))}
      </View>
    );
  } else if (comments.isError) {
    body = (
      <View style={styles.centered}>
        <AppText variant="ui.body" tone="secondary">
          Couldn't load comments.
        </AppText>
        <LinkButton label="Try again" onPress={() => void comments.refetch()} />
      </View>
    );
  } else {
    body = (
      <FlatList
        ref={listRef}
        data={items}
        keyExtractor={(item) => item.id}
        renderItem={({ item, index }) => (
          <CommentRow
            comment={item}
            showDivider={index < items.length - 1}
            onReport={setReportTarget}
            onBlock={setBlockTarget}
            onDelete={setDeleteTarget}
          />
        )}
        onEndReached={() => {
          if (comments.hasNextPage && !comments.isFetchingNextPage && !comments.isFetchNextPageError) {
            void comments.fetchNextPage();
          }
        }}
        onEndReachedThreshold={0.4}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={comments.isRefetching && !comments.isFetchingNextPage}
            onRefresh={() => void comments.refetch()}
            tintColor={colors.accent.goldText}
          />
        }
        ListEmptyComponent={
          <View style={styles.centered}>
            <AppText variant="ui.body" tone="secondary">
              No comments yet. Be the first to share.
            </AppText>
          </View>
        }
        ListFooterComponent={footer}
        style={styles.list}
      />
    );
  }

  const showNotice = Boolean(publicName) && noticeSeen === false;

  return (
    <View style={panelStyle}>
      {/* No `TouchableWithoutFeedback` wrapper here on purpose — it was tried (session
          2026-10-08) to dismiss the keyboard on a background tap, but it installs its own
          touch responder on this whole area, which wins the responder negotiation against
          the FlatList below *before* the list's own scroll/pull-to-refresh gesture gets a
          chance to claim the touch — it broke both. The FlatList's own
          `keyboardShouldPersistTaps="handled"` + `keyboardDismissMode="on-drag"` already
          dismiss the keyboard on a background tap or a scroll drag inside the list, which
          covers the real case (tapping away from an open keyboard while the thread is
          showing) without touching its gesture handling. */}
      {signature ? (
        <View
          style={[styles.header, styles.signatureHeader]}
          accessible
          accessibilityRole="header"
          accessibilityLabel={`${total} ${total === 1 ? 'comment' : 'comments'}`}
        >
          <AppText variant="display.row">Comments</AppText>
          <AppText variant="mono.meta" tone="tertiary">
            {total}
          </AppText>
        </View>
      ) : (
        <View style={styles.header}>
          <AppText variant="ui.label" accessibilityRole="header">
            {`${total} ${total === 1 ? 'comment' : 'comments'}`}
          </AppText>
        </View>
      )}

      {body}

      {message ? (
        <View style={styles.message} accessibilityLiveRegion="polite">
          <AppText
            variant="ui.badge"
            tone={message.kind === 'error' ? 'primary' : 'secondary'}
            style={[styles.messageText, message.kind === 'error' && styles.messageError]}
          >
            {message.kind === 'reported'
              ? "Thanks, we'll review this."
              : message.kind === 'blocked'
                ? `${message.name} blocked.`
                : message.text}
          </AppText>
          {message.kind === 'blocked' && message.blockId ? (
            <LinkButton label="Undo" onPress={() => undoBlock(message.blockId!)} />
          ) : null}
        </View>
      ) : null}

      <CommentComposer
        viewerName={fullName || user?.email || ''}
        isPosting={post.isPending}
        error={postError}
        bottomInset={signature ? 0 : insets.bottom}
        onGate={gate}
        onSubmit={submitComment}
        notice={
          showNotice ? (
            <AppearAsNotice
              displayName={publicName!}
              onChange={() => setPrompt('editName')}
              onDismiss={dismissNotice}
            />
          ) : undefined
        }
      />

      <NamePrompt
        visible={prompt === 'name' || prompt === 'editName'}
        initialName={fullName}
        title={prompt === 'editName' ? 'Your name' : 'Add your name'}
        saveLabel={prompt === 'editName' ? 'Save' : 'Save and continue'}
        onClose={() => setPrompt(null)}
        onSaved={(saved) =>
          setPrompt(prompt === 'name' && !saved.comments_terms_accepted_at ? 'terms' : null)
        }
      />
      <TermsSheet visible={prompt === 'terms'} onClose={() => setPrompt(null)} onAccepted={() => setPrompt(null)} />
      <ReportSheet
        visible={reportTarget !== null}
        authorName={reportTarget?.author_display_name ?? ''}
        onClose={closeReport}
        onSubmit={submitReport}
        onBlock={() => {
          reportedRef.current = false;
          setBlockTarget(reportTarget);
          setReportTarget(null);
        }}
        errorMessage={reportErrorMessage}
      />
      <ConfirmDialog
        visible={blockTarget !== null}
        title={`Block ${blockTarget?.author_display_name ?? ''}?`}
        body="You won't see their comments on any sermon. They won't be told. You can unblock them any time in Me, Blocked users."
        confirmLabel="Block"
        onConfirm={confirmBlock}
        onCancel={() => setBlockTarget(null)}
      />
      <ConfirmDialog
        visible={deleteTarget !== null}
        title="Delete this comment?"
        body="This can't be undone."
        confirmLabel="Delete"
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </View>
  );
}

const useStyles = createThemedStyles((colors) => ({
  panel: {
    flex: 1,
    backgroundColor: colors.surface.raised,
    borderColor: colors.border.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: 0,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    overflow: 'hidden',
  },
  header: {
    padding: spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border.default,
  },
  signaturePanel: {
    ...LEAF,
    marginHorizontal: spacing.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border.default,
  },
  signatureHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: spacing.sm,
    paddingBottom: spacing.md,
  },
  list: {
    flex: 1,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    padding: spacing.xxl,
  },
  offline: {
    alignItems: 'center',
    gap: spacing.sm,
  },
  skeletons: {
    flex: 1,
    paddingVertical: spacing.md,
  },
  skeletonRow: {
    flexDirection: 'row',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  skeletonLines: {
    flex: 1,
    gap: spacing.sm,
    justifyContent: 'center',
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    padding: spacing.md,
  },
  message: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface.nav,
  },
  messageText: {
    flex: 1,
  },
  messageError: {
    color: colors.status.rose.text,
  },
}));
