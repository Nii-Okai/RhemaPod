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

// `NavIcon` (every chrome's icon renderer, since the "You" tab needs profile data for
// its avatar) calls `useCurrentUser`, a react-query hook — mocked directly rather than
// wrapping every render here in a `QueryClientProvider`, same reasoning `useDownloads`
// gets mocked directly elsewhere: these tests care about nav structure, not profile data.
jest.mock('../../../lib/query/hooks/useProfile', () => ({ useCurrentUser: () => ({ data: undefined }) }));

const push = jest.fn();
let mockPathname = '/home';

const mockedUseRouter = useRouter as jest.Mock;

beforeEach(() => {
  push.mockClear();
  mockedUseRouter.mockReturnValue({ push });
  mockPathname = '/home';
});

describe('PhoneTabBarIOS', () => {
  it('shows the four P1-resolved labels (icon + label each) and navigates on press', () => {
    const { getByText, queryByText } = render(<PhoneTabBarIOS />);

    for (const label of ['Home', 'Browse', 'Library', 'You']) {
      expect(getByText(label)).toBeTruthy();
    }
    expect(queryByText('Saved')).toBeNull();
    expect(queryByText('Search')).toBeNull();

    fireEvent.press(getByText('Browse'));
    expect(push).toHaveBeenCalledWith('/(tabs)/browse');
  });

  it('marks the tab matching the current route as selected', () => {
    mockPathname = '/library';
    const { getByRole } = render(<PhoneTabBarIOS />);

    expect(getByRole('button', { name: 'Library' }).props.accessibilityState).toEqual({ selected: true });
    expect(getByRole('button', { name: 'Home' }).props.accessibilityState).toEqual({ selected: false });
  });
});

describe('PhoneTabBarAndroid', () => {
  it('shows the same four destinations as iOS and navigates on press', () => {
    const { getByText } = render(<PhoneTabBarAndroid />);

    for (const label of ['Home', 'Browse', 'Library', 'You']) {
      expect(getByText(label)).toBeTruthy();
    }

    fireEvent.press(getByText('Library'));
    expect(push).toHaveBeenCalledWith('/(tabs)/library');
  });
});

describe('TabletRail', () => {
  it('shows Series and Announcements (P3), omits a dedicated You item, and navigates on press', () => {
    const { getByText, queryByText, getByLabelText } = render(<TabletRail />);

    for (const label of ['Home', 'Series', 'Browse', 'Library', 'Announcements']) {
      expect(getByText(label)).toBeTruthy();
    }
    expect(queryByText('You')).toBeNull();

    fireEvent.press(getByText('Series'));
    expect(push).toHaveBeenCalledWith('/(tabs)/series');

    fireEvent.press(getByLabelText('Profile & settings'));
    expect(push).toHaveBeenCalledWith('/(tabs)/me');
  });
});
