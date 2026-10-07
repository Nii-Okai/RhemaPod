import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { useRouter } from 'expo-router';
import { PhoneTabBarAndroid } from '../PhoneTabBarAndroid';
import { PhoneTabBarIOS } from '../PhoneTabBarIOS';
import { TabletRail } from '../TabletRail';

jest.mock('expo-router', () => ({
  usePathname: () => mockPathname,
  useRouter: jest.fn(),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

// See `__mocks__/@expo/vector-icons.tsx` — real Ionicons needs native font-loading
// machinery `jest-expo` doesn't stand up in this test environment.
jest.mock('@expo/vector-icons');

const push = jest.fn();
let mockPathname = '/home';

const mockedUseRouter = useRouter as jest.Mock;

beforeEach(() => {
  push.mockClear();
  mockedUseRouter.mockReturnValue({ push });
  mockPathname = '/home';
});

describe('PhoneTabBarIOS', () => {
  it('shows the four P1-resolved, text-only labels and navigates on press', () => {
    const { getByText, queryByText } = render(<PhoneTabBarIOS />);

    for (const label of ['Home', 'Browse', 'Downloads', 'Me']) {
      expect(getByText(label)).toBeTruthy();
    }
    expect(queryByText('Saved')).toBeNull();
    expect(queryByText('Search')).toBeNull();

    fireEvent.press(getByText('Browse'));
    expect(push).toHaveBeenCalledWith('/(tabs)/browse');
  });

  it('marks the tab matching the current route as selected', () => {
    mockPathname = '/downloads';
    const { getByRole } = render(<PhoneTabBarIOS />);

    expect(getByRole('button', { name: 'Downloads' }).props.accessibilityState).toEqual({ selected: true });
    expect(getByRole('button', { name: 'Home' }).props.accessibilityState).toEqual({ selected: false });
  });
});

describe('PhoneTabBarAndroid', () => {
  it('shows the same four destinations as iOS and navigates on press', () => {
    const { getByText } = render(<PhoneTabBarAndroid />);

    for (const label of ['Home', 'Browse', 'Downloads', 'Me']) {
      expect(getByText(label)).toBeTruthy();
    }

    fireEvent.press(getByText('Downloads'));
    expect(push).toHaveBeenCalledWith('/(tabs)/downloads');
  });
});

describe('TabletRail', () => {
  it('shows Series and Announcements (P3), omits a dedicated Me item, and navigates on press', () => {
    const { getByText, queryByText, getByLabelText } = render(<TabletRail />);

    for (const label of ['Home', 'Series', 'Browse', 'Downloads', 'Announcements']) {
      expect(getByText(label)).toBeTruthy();
    }
    expect(queryByText('Me')).toBeNull();

    fireEvent.press(getByText('Series'));
    expect(push).toHaveBeenCalledWith('/(tabs)/series');

    fireEvent.press(getByLabelText('Profile & settings'));
    expect(push).toHaveBeenCalledWith('/(tabs)/me');
  });
});
