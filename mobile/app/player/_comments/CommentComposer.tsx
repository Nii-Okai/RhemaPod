import React, { useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AppText, Avatar } from '../../../components';
import { colors } from '../../../theme/colors';
import { radius } from '../../../theme/radius';
import { spacing } from '../../../theme/spacing';
import { fontFamily } from '../../../theme/typography';

export const COMMENT_MAX_LENGTH = 1000;
const COUNTER_FROM = 900;

export interface CommentComposerProps {
  /** The viewer's own name, for their avatar. */
  viewerName: string;
  isPosting: boolean;
  /** The last post failure, shown above the field; the draft is kept. */
  error: string | null;
  /** Optional strip above the field (the one-time "appear as" notice). */
  notice?: React.ReactNode;
  /**
   * Called on the first tap of the field and on send. Returns true when a prompt (name or
   * terms) was opened instead — the composer then does not proceed.
   */
  onGate: () => boolean;
  /** Resolves true when the post succeeded and the draft should be cleared. */
  onSubmit: (body: string) => Promise<boolean>;
}

/**
 * The comment composer (design spec §2.6): a pill with the viewer's avatar, a multiline
 * input and a send button. Posting is not optimistic — the draft stays until the server
 * accepts it, and stays on any failure. The client does no content pre-check: the server's
 * 422 text is shown as written. Name/terms gating is the caller's (`onGate`), which keeps
 * the draft across both prompts.
 */
export function CommentComposer({ viewerName, isPosting, error, notice, onGate, onSubmit }: CommentComposerProps) {
  const [draft, setDraft] = useState('');
  const canSend = draft.trim().length > 0 && !isPosting;
  // `isPosting` comes from the caller's mutation state and only updates on the next
  // render, which can lag a rapid double-tap by a frame. This ref is set synchronously so
  // a second tap landing before that re-render still can't fire a second POST.
  const sendingRef = useRef(false);

  const send = async () => {
    if (!canSend || sendingRef.current) return;
    if (onGate()) return;
    sendingRef.current = true;
    const body = draft.trim();
    try {
      if (await onSubmit(body)) {
        // Functional update: only clear the draft if it still matches what was sent. If
        // the user kept typing while the POST was in flight, their newer text survives.
        setDraft((current) => (current === body ? '' : current));
      }
    } finally {
      sendingRef.current = false;
    }
  };

  return (
    <View style={styles.wrap}>
      {notice}
      {error ? (
        <AppText variant="ui.badge" style={styles.error} accessibilityLiveRegion="polite">
          {error}
        </AppText>
      ) : null}
      <View style={styles.pill}>
        <Avatar name={viewerName} seed={viewerName} size={38} />
        <TextInput
          accessibilityLabel="Write a comment"
          value={draft}
          onChangeText={setDraft}
          onFocus={() => void onGate()}
          placeholder="Share your thoughts..."
          placeholderTextColor={colors.text.tertiary}
          multiline
          // Counts UTF-16 code units (RN's TextInput maxLength semantics); the server
          // counts normalised characters. The two can disagree for text outside the
          // basic multilingual plane (e.g. some emoji), so a draft right at the limit
          // here may still get a 422 from the server's own count. Not reconciled — see
          // plan review notes.
          maxLength={COMMENT_MAX_LENGTH}
          autoCapitalize="sentences"
          dataDetectorTypes="none"
          style={styles.input}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Post comment"
          accessibilityState={{ disabled: !canSend, busy: isPosting }}
          disabled={!canSend}
          onPress={() => void send()}
          hitSlop={spacing.xs}
          style={[styles.send, canSend ? styles.sendEnabled : styles.sendDisabled]}
        >
          {isPosting ? (
            <ActivityIndicator color={colors.primaryButton.text} />
          ) : (
            <Ionicons name="paper-plane" size={20} color={canSend ? colors.primaryButton.text : colors.text.tertiary} />
          )}
        </Pressable>
      </View>
      {draft.length >= COUNTER_FROM ? (
        <AppText
          variant="mono.meta"
          tone="tertiary"
          style={[styles.counter, draft.length >= COMMENT_MAX_LENGTH && styles.counterFull]}
        >
          {`${draft.length}/${COMMENT_MAX_LENGTH}`}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: spacing.sm,
    backgroundColor: colors.surface.raised,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border.default,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
    minHeight: 44,
    backgroundColor: colors.surface.sunken,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border.card,
    borderRadius: radius.xl,
    padding: spacing.xs,
  },
  input: {
    flex: 1,
    maxHeight: 96,
    minHeight: 38,
    paddingVertical: spacing.sm,
    color: colors.text.primary,
    fontFamily: fontFamily.ui,
    fontSize: 14,
  },
  send: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendEnabled: {
    backgroundColor: colors.accent.gold,
  },
  sendDisabled: {
    backgroundColor: colors.track.default,
  },
  error: {
    color: colors.status.rose.text,
  },
  counter: {
    alignSelf: 'flex-end',
  },
  counterFull: {
    color: colors.status.rose.text,
  },
});
