import React from 'react';
import { Animated } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import { HomeTopBar } from '../HomeTopBar';

jest.mock('@expo/vector-icons');

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 20, bottom: 0, left: 0, right: 0 }),
}));

function flattenStyle(style: unknown): Record<string, unknown> {
  if (Array.isArray(style)) {
    return Object.assign({}, ...style.map(flattenStyle));
  }
  return (style as Record<string, unknown>) || {};
}

describe('HomeTopBar', () => {
  it('renders the wordmark, with no Library icon, and fires each remaining icon button\'s callback', () => {
    const onSearchPress = jest.fn();
    const onNotificationsPress = jest.fn();
    const { getByText, getByLabelText, queryByLabelText } = render(
      <HomeTopBar onSearchPress={onSearchPress} onNotificationsPress={onNotificationsPress} />,
    );

    expect(getByText('RhemaPod')).toBeTruthy();
    expect(queryByLabelText('Library')).toBeNull();

    fireEvent.press(getByLabelText('Search'));
    expect(onSearchPress).toHaveBeenCalledTimes(1);
    fireEvent.press(getByLabelText('Notifications'));
    expect(onNotificationsPress).toHaveBeenCalledTimes(1);
  });

  it('shows an unread badge on the bell only when there is an unseen count, capped at "9+"', () => {
    const { queryByText, rerender } = render(<HomeTopBar onSearchPress={jest.fn()} onNotificationsPress={jest.fn()} />);
    expect(queryByText('3')).toBeNull();

    rerender(<HomeTopBar onSearchPress={jest.fn()} onNotificationsPress={jest.fn()} unseenNotificationsCount={3} />);
    expect(queryByText('3')).toBeTruthy();

    rerender(<HomeTopBar onSearchPress={jest.fn()} onNotificationsPress={jest.fn()} unseenNotificationsCount={14} />);
    expect(queryByText('9+')).toBeTruthy();
  });

  it('reports its own rendered height via onHeight', () => {
    const onHeight = jest.fn();
    const { getByTestId } = render(
      <HomeTopBar onSearchPress={jest.fn()} onNotificationsPress={jest.fn()} onHeight={onHeight} />,
    );

    fireEvent(getByTestId('home-top-bar'), 'layout', {
      nativeEvent: { layout: { x: 0, y: 0, width: 400, height: 88 } },
    });

    expect(onHeight).toHaveBeenCalledWith(88);
  });

  it('renders a constant (non-interpolated) solid background when no scrollY is given', () => {
    const { UNSAFE_getAllByType } = render(<HomeTopBar onSearchPress={jest.fn()} onNotificationsPress={jest.fn()} />);

    const animatedView = UNSAFE_getAllByType(Animated.View)[0];
    const flat = flattenStyle(animatedView.props.style);
    expect(flat.opacity).toBe(1);
  });

  it('drives the solid background from an interpolation when scrollY is given', () => {
    const scrollY = new Animated.Value(0);
    const { UNSAFE_getAllByType } = render(
      <HomeTopBar onSearchPress={jest.fn()} onNotificationsPress={jest.fn()} scrollY={scrollY} />,
    );

    const animatedView = UNSAFE_getAllByType(Animated.View)[0];
    const flat = flattenStyle(animatedView.props.style);
    // Not a plain number — proves the fade is actually wired to `scrollY`, not a static 1.
    expect(typeof flat.opacity).not.toBe('number');
  });
});
