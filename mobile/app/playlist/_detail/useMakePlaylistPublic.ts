import { useCallback, useRef } from 'react';
import { Alert } from 'react-native';
import { ApiError, userMessageFor } from '../../../lib/api/errors';
import { previewDisplayName } from '../../../lib/format/displayName';
import { useCurrentUser } from '../../../lib/query/hooks/useProfile';
import { useUpdatePlaylist } from '../../../lib/query/hooks/usePlaylists';

export const MAKE_PUBLIC_FAILURE = "Couldn't make this playlist public. Try again.";

/** A 422 carries the server's content-rule message; anything else gets the generic copy. */
export function makePublicFailureMessage(error: unknown): string {
  return error instanceof ApiError && error.status === 422 ? userMessageFor(error) : MAKE_PUBLIC_FAILURE;
}

export interface MakePlaylistPublic {
  /**
   * Asks "Make this playlist public?" and, on Yes, PATCHes `is_public: true`. No does nothing.
   * `onSuccess` runs only after the PATCH succeeded; `onFailure` gets the message to show.
   * Ignored while a prompt is open or the PATCH is in flight, so taps can't stack alerts.
   */
  confirmAndMakePublic: (handlers?: { onSuccess?: () => void; onFailure?: (message: string) => void }) => void;
  /** True while the PATCH is pending. */
  busy: boolean;
  /** False until the viewer's profile has resolved, so the prompt never shows a placeholder name. */
  ready: boolean;
}

/**
 * The one make-public flow, shared by the playlist's Share action and the "Make public"
 * row in Name & details. The prompt names the owner as "First L." (the form other viewers
 * see) and omits that sentence if no name is available.
 */
export function useMakePlaylistPublic(playlistId: string): MakePlaylistPublic {
  const profile = useCurrentUser();
  const update = useUpdatePlaylist(playlistId);
  const promptOpen = useRef(false);

  const confirmAndMakePublic = useCallback<MakePlaylistPublic['confirmAndMakePublic']>(
    ({ onSuccess, onFailure } = {}) => {
      if (promptOpen.current || update.isPending) return;
      promptOpen.current = true;
      const ownerName = previewDisplayName(profile.data?.full_name);
      const body =
        'Anyone with the link can see it and its sermons.' + (ownerName ? ` Your name shows as '${ownerName}'.` : '');
      const release = () => {
        promptOpen.current = false;
      };
      Alert.alert(
        'Make this playlist public?',
        body,
        [
          { text: 'No', style: 'cancel', onPress: release },
          {
            text: 'Yes',
            onPress: () => {
              update.mutate(
                { isPublic: true },
                {
                  onSuccess: () => onSuccess?.(),
                  onError: (e) => onFailure?.(makePublicFailureMessage(e)),
                  onSettled: release,
                },
              );
            },
          },
        ],
        { cancelable: true, onDismiss: release },
      );
    },
    [profile.data?.full_name, update],
  );

  return { confirmAndMakePublic, busy: update.isPending, ready: !profile.isPending };
}
