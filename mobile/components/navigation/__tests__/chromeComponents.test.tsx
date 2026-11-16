import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { useRouter } from 'expo-router';
import { FloatingDock, TODAY_HREF } from '../FloatingDock';
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

describe('FloatingDock', () => {
  it('shows the four destinations plus the raised Today button, and navigates on press', () => {
    const { getByText, queryByText, getByRole } = render(<FloatingDock />);

    for (const label of ['Home', 'Discover', 'Library', 'You']) {
      expect(getByText(label)).toBeTruthy();
    }
    expect(queryByText('Saved')).toBeNull();
    expect(queryByText('Search')).toBeNull();

    fireEvent.press(getByText('Discover'));
    expect(push).toHaveBeenCalledWith('/(tabs)/browse');

    fireEvent.press(getByRole('button', { name: 'Today, Daily Rhema' }));
    expect(push).toHaveBeenCalledWith(TODAY_HREF);
    expect(TODAY_HREF).toBe('/devotional/today');
  });

  it('marks the tab matching the current route as selected', () => {
    mockPathname = '/library';
    const { getByRole } = render(<FloatingDock />);

    expect(getByRole('button', { name: 'Library' }).props.accessibilityState).toEqual({ selected: true });
    expect(getByRole('button', { name: 'Home' }).props.accessibilityState).toEqual({ selected: false });
    expect(getByRole('button', { name: 'Today, Daily Rhema' }).props.accessibilityState).toEqual({ selected: false });
  });

  it('marks Today as selected inside the Daily Rhema flow', () => {
    mockPathname = '/devotional/today';
    const { getByRole } = render(<FloatingDock />);

    expect(getByRole('button', { name: 'Today, Daily Rhema' }).props.accessibilityState).toEqual({ selected: true });
  });
});

describe('TabletRail', () => {
  it('shows Series and Announcements (P3), omits a dedicated You item, and navigates on press', () => {
    const { getByText, queryByText, getByLabelText } = render(<TabletRail />);

    for (const label of ['Home', 'Series', 'Discover', 'Library', 'Announcements']) {
      expect(getByText(label)).toBeTruthy();
    }
    expect(queryByText('You')).toBeNull();

    fireEvent.press(getByText('Series'));
    expect(push).toHaveBeenCalledWith('/(tabs)/series');

    fireEvent.press(getByLabelText('Profile & settings'));
    expect(push).toHaveBeenCalledWith('/(tabs)/me');
  });
});
