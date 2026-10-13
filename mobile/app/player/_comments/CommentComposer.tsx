import React, { useRef, useState } from 'react';
import { ActivityIndicator, Keyboard, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { AppText, Avatar, PlatformIcon } from '../../../components';
import { colors } from '../../../theme/colors';
import { radius } from '../../../theme/radius';
import { spacing } from '../../../theme/spacing';
import { fontFamily } from '../../../theme/typography';

export const COMMENT_MAX_LENGTH = 1000;
const COUNTER_FROM = 900;
const INPUT_MIN_HEIGHT = 38;
const INPUT_MAX_HEIGHT = 96;

export interface CommentComposerProps {
  /** The viewer's own name, for their avatar. */
  viewerName: string;
  isPosting: boolean;
  /** The last post failure, shown above the field; the draft is kept. */
  error: string | null;
  /** Optional strip above the field (the one-time "appear as" notice). */
  notice?: React.ReactNode;
  /** Device safe-area bottom inset (home indicator etc.) — added to the composer's own
   * bottom padding so it doesn't sit flush against the edge when the keyboard is closed.
   * `KeyboardAvoidingView` already covers the keyboard-open case. */
  bottomInset?: number;
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
export function CommentComposer({
  viewerName,
  isPosting,
  error,
  notice,
  bottomInset = 0,
  onGate,
  onSubmit,
}: CommentComposerProps) {
  const [draft, setDraft] = useState('');
  // CSS `maxHeight` on a multiline `TextInput` is unreliable as a growth cap — both
  // platforms can report a native content size past it, which then stretches this pill
  // (its height tracks the input) while the avatar/send stay pinned to the bottom edge via
  // `alignItems: 'flex-end'`, leaving a tall gap under the text. Measuring and clamping the
  // height explicitly (RN's own documented auto-expanding-input pattern) is the reliable
  // fix, not a bigger `maxHeight`.
  const [inputHeight, setInputHeight] = useState(INPUT_MIN_HEIGHT);
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
        // the user kept typing while the POST was in flight, their newer text survives —
        // and in that case the keyboard stays up too, since there's still a draft to finish.
        let cleared = false;
        setDraft((current) => {
          if (current !== body) return current;
          cleared = true;
          setInputHeight(INPUT_MIN_HEIGHT);
          return '';
        });
        if (cleared) Keyboard.dismiss();
      }
    } finally {
      sendingRef.current = false;
    }
  };

  return (
    <View style={[styles.wrap, { paddingBottom: spacing.sm + bottomInset }]}>
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
          onContentSizeChange={(event) => {
            const next = event.nativeEvent.contentSize.height;
            setInputHeight(Math.min(INPUT_MAX_HEIGHT, Math.max(INPUT_MIN_HEIGHT, next)));
          }}
          style={[styles.input, { height: inputHeight }]}
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
            <PlatformIcon name="paper-plane" size={20} color={canSend ? colors.primaryButton.text : colors.text.tertiary} />
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
    // Height is set explicitly per render (`inputHeight` state, clamped between
    // INPUT_MIN_HEIGHT/INPUT_MAX_HEIGHT) — see the component's own note on why CSS
    // `minHeight`/`maxHeight` alone aren't a reliable growth cap here.
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
