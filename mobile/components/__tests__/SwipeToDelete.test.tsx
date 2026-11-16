import React from 'react';
import { Text } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import { SwipeToDelete } from '../SwipeToDelete';

/**
 * The swipe gesture itself is `PanResponder` (core React Native, not custom logic worth
 * re-testing here) — these tests cover the two actual delete paths this component adds:
 * the revealed red action button (reached in the app by a real swipe, not simulated here
 * — see the a11y-action test's own comment for why) and the `accessibilityActions`
 * fallback for VoiceOver/TalkBack, which is independent of the gesture entirely.
 */
describe('SwipeToDelete', () => {
  it('renders its children', () => {
    const { getByText } = render(
      <SwipeToDelete onDelete={jest.fn()} deleteAccessibilityLabel="Delete downloaded A Sermon">
        <Text>A Sermon</Text>
      </SwipeToDelete>,
    );
    expect(getByText('A Sermon')).toBeTruthy();
  });

  it('calls onDelete via its accessibility action, with no swipe required (VoiceOver/TalkBack path)', () => {
    const onDelete = jest.fn();
    const { getByTestId } = render(
      <SwipeToDelete onDelete={onDelete} deleteAccessibilityLabel="Delete downloaded A Sermon" testID="row">
        <Text>A Sermon</Text>
      </SwipeToDelete>,
    );

    fireEvent(getByTestId('row'), 'accessibilityAction', { nativeEvent: { actionName: 'delete' } });
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it('ignores an accessibility action it does not recognize', () => {
    const onDelete = jest.fn();
    const { getByTestId } = render(
      <SwipeToDelete onDelete={onDelete} deleteAccessibilityLabel="Delete downloaded A Sermon" testID="row">
        <Text>A Sermon</Text>
      </SwipeToDelete>,
    );

    fireEvent(getByTestId('row'), 'accessibilityAction', { nativeEvent: { actionName: 'activate' } });
    expect(onDelete).not.toHaveBeenCalled();
  });

  it('the revealed delete button is not pointer-reachable until the row is swiped open (so a real, not-yet-revealed touch cannot land on it)', () => {
    const onDelete = jest.fn();
    const { getByLabelText } = render(
      <SwipeToDelete onDelete={onDelete} deleteAccessibilityLabel="Delete downloaded A Sermon">
        <Text>A Sermon</Text>
      </SwipeToDelete>,
    );

    // Closed by default — `fireEvent.press` correctly refuses to fire through a
    // `pointerEvents: 'none'` ancestor, same as a real touch would.
    fireEvent.press(getByLabelText('Delete downloaded A Sermon'));
    expect(onDelete).not.toHaveBeenCalled();
  });
});
