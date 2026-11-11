import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { HomeHeader, greetingFor } from '../HomeHeader';

jest.mock('@expo/vector-icons');
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
let mockUser: { full_name: string } | undefined;
jest.mock('../../../../lib/query/hooks/useProfile', () => ({ useCurrentUser: () => ({ data: mockUser }) }));

const at = (hour: number) => new Date(2026, 10, 11, hour, 0, 0);

describe('greetingFor', () => {
  it('follows the time of day', () => {
    expect(greetingFor(at(7))).toBe('Good morning');
    expect(greetingFor(at(13))).toBe('Good afternoon');
    expect(greetingFor(at(20))).toBe('Good evening');
  });
});

describe('HomeHeader', () => {
  beforeEach(() => {
    mockUser = undefined;
  });

  it('greets the listener by first name under the RhemaPod wordmark', () => {
    mockUser = { full_name: 'Nii Okai' };
    const { getByText, getByLabelText } = render(
      <HomeHeader onSearchPress={jest.fn()} onNotificationsPress={jest.fn()} now={at(8)} />,
    );
    expect(getByText('Good morning, Nii')).toBeTruthy();
    expect(getByLabelText('RhemaPod')).toBeTruthy();
  });

  it('greets without a name until the profile loads', () => {
    const { getByText } = render(<HomeHeader onSearchPress={jest.fn()} onNotificationsPress={jest.fn()} now={at(19)} />);
    expect(getByText('Good evening')).toBeTruthy();
  });

  it('opens search and notifications, and announces unseen releases', () => {
    const onSearchPress = jest.fn();
    const onNotificationsPress = jest.fn();
    const { getByLabelText } = render(
      <HomeHeader onSearchPress={onSearchPress} onNotificationsPress={onNotificationsPress} unseenNotificationsCount={3} />,
    );
    fireEvent.press(getByLabelText('Search'));
    fireEvent.press(getByLabelText('Notifications, 3 new'));
    expect(onSearchPress).toHaveBeenCalled();
    expect(onNotificationsPress).toHaveBeenCalled();
  });
});
