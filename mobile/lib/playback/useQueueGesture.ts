import type { AccessibilityActionEvent, AccessibilityActionInfo } from 'react-native';
import { useNowPlaying } from './nowPlayingContext';
import { queueItemFromSermon, type SermonLike } from './queue';

export interface QueueGestureProps {
  onLongPress?: () => void;
  accessibilityActions?: AccessibilityActionInfo[];
  onAccessibilityAction?: (event: AccessibilityActionEvent) => void;
}

const ACTIONS: AccessibilityActionInfo[] = [
  { name: 'playNext', label: 'Play next' },
  { name: 'addToQueue', label: 'Add to queue' },
];

/**
 * Press props that put a sermon row on the queue: a long press opens the Play next / Add
 * to queue sheet, and VoiceOver/TalkBack get both as actions on the row. Nothing for a
 * sermon this listener can't play from a list (locked, or no media yet), or outside
 * `NowPlayingProvider` (unit tests, the dev gallery).
 */
export function useQueueGesture(sermon: SermonLike | null | undefined): QueueGestureProps {
  const nowPlaying = useNowPlaying();
  if (!nowPlaying || !sermon || sermon.locked || !sermon.media_type) return {};
  const input = () => queueItemFromSermon(sermon);
  return {
    onLongPress: () => nowPlaying.openQueueMenu(input()),
    accessibilityActions: ACTIONS,
    onAccessibilityAction: (event) => {
      if (event.nativeEvent.actionName === 'playNext') nowPlaying.enqueue(input(), 'next');
      else if (event.nativeEvent.actionName === 'addToQueue') nowPlaying.enqueue(input(), 'last');
    },
  };
}
