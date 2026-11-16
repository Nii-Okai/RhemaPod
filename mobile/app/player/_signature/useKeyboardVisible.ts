import { useEffect, useState } from 'react';
import { Keyboard, Platform } from 'react-native';

/**
 * Whether the software keyboard is up. The Signature player folds its title block and
 * toolbar away while someone types a comment, so the composer keeps the room under the
 * video. iOS reports the "will" events, so the fold starts with the keyboard's own
 * animation; Android only has the "did" ones.
 */
export function useKeyboardVisible(): boolean {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const show = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hide = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const subs = [Keyboard.addListener(show, () => setVisible(true)), Keyboard.addListener(hide, () => setVisible(false))];
    return () => subs.forEach((sub) => sub.remove());
  }, []);
  return visible;
}
