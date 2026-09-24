import React from 'react';
import { act, render } from '@testing-library/react-native';
import { Dimensions, Text } from 'react-native';
import { NavShell } from '../NavShell';
import { usePlatformOS } from '../platform';

jest.mock('expo-router', () => ({
  usePathname: () => '/home',
  useRouter: () => ({ push: jest.fn() }),
}));

jest.mock('../platform', () => ({
  usePlatformOS: jest.fn(() => 'ios'),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

// See `__mocks__/@expo/vector-icons.tsx` — real Ionicons needs native font-loading
// machinery `jest-expo` doesn't stand up in this test environment.
jest.mock('@expo/vector-icons');

const mockedUsePlatformOS = usePlatformOS as jest.Mock;

function setWindowWidth(width: number) {
  act(() => {
    Dimensions.set({
      window: { width, height: 800, scale: 2, fontScale: 1 },
      screen: { width, height: 800, scale: 2, fontScale: 1 },
    });
  });
}

/**
 * Plan W3.4 verification: "the same route renders all three chromes" and "resizing an
 * iPad into narrow Split View falls back to the phone layout live" — proven here, not
 * just by visual inspection. `children` stands in for the routed screen content: it is
 * literally the same element in every case, only the surrounding chrome changes.
 */
describe('NavShell — one route, three chromes', () => {
  afterEach(() => {
    setWindowWidth(375);
  });

  it('renders the iOS text-only tab bar under 768pt on iOS, same route content', () => {
    mockedUsePlatformOS.mockReturnValue('ios');
    setWindowWidth(375);

    const { getByTestId, queryByTestId, getByText } = render(
      <NavShell>
        <Text>Home route content</Text>
      </NavShell>,
    );

    expect(getByTestId('phone-tab-bar-ios')).toBeTruthy();
    expect(queryByTestId('phone-tab-bar-android')).toBeNull();
    expect(queryByTestId('tablet-rail')).toBeNull();
    expect(getByText('Home route content')).toBeTruthy();
  });

  it('renders the Android M3 nav bar under 768pt on Android, same route content', () => {
    mockedUsePlatformOS.mockReturnValue('android');
    setWindowWidth(375);

    const { getByTestId, queryByTestId, getByText } = render(
      <NavShell>
        <Text>Home route content</Text>
      </NavShell>,
    );

    expect(getByTestId('phone-tab-bar-android')).toBeTruthy();
    expect(queryByTestId('phone-tab-bar-ios')).toBeNull();
    expect(queryByTestId('tablet-rail')).toBeNull();
    expect(getByText('Home route content')).toBeTruthy();
  });

  it('renders the tablet rail at/above 768pt regardless of platform, same route content', () => {
    mockedUsePlatformOS.mockReturnValue('android');
    setWindowWidth(1024);

    const { getByTestId, queryByTestId, getByText } = render(
      <NavShell>
        <Text>Home route content</Text>
      </NavShell>,
    );

    expect(getByTestId('tablet-rail')).toBeTruthy();
    expect(queryByTestId('phone-tab-bar-ios')).toBeNull();
    expect(queryByTestId('phone-tab-bar-android')).toBeNull();
    expect(getByText('Home route content')).toBeTruthy();
  });

  it('falls back live from the tablet rail to the phone chrome when an iPad narrows into Split View', () => {
    mockedUsePlatformOS.mockReturnValue('ios');
    setWindowWidth(1024);

    const { getByTestId, queryByTestId } = render(
      <NavShell>
        <Text>Home route content</Text>
      </NavShell>,
    );

    expect(getByTestId('tablet-rail')).toBeTruthy();

    // Same live component instance — an iPad narrowing mid-session, not a fresh mount.
    setWindowWidth(320);

    expect(queryByTestId('tablet-rail')).toBeNull();
    expect(getByTestId('phone-tab-bar-ios')).toBeTruthy();
  });

  it('restores the tablet rail live when the same instance widens back out of Split View', () => {
    mockedUsePlatformOS.mockReturnValue('ios');
    setWindowWidth(320);

    const { getByTestId, queryByTestId } = render(
      <NavShell>
        <Text>Home route content</Text>
      </NavShell>,
    );

    expect(getByTestId('phone-tab-bar-ios')).toBeTruthy();

    setWindowWidth(1024);

    expect(queryByTestId('phone-tab-bar-ios')).toBeNull();
    expect(getByTestId('tablet-rail')).toBeTruthy();
  });
});
