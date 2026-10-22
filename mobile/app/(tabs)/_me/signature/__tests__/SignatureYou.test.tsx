import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClientProvider } from '@tanstack/react-query';
import * as RN from 'react-native';
import { SignatureYouScreen } from '../SignatureYou';
import { api } from '../../../../../lib/api/typedClient';
import { CONTACT_EMAIL } from '../../../../../lib/content/commentsCompliance';
import { useAuth } from '../../../../../lib/auth/AuthContext';
import { useDownloads } from '../../../../../lib/downloads/useDownloads';
import { createTestQueryClient } from '../../../../../lib/query/testUtils';
import { ThemeProvider, useTheme } from '../../../../../theme/ThemeContext';

jest.mock('../../../../../lib/api/typedClient', () => ({
  api: { get: jest.fn(), patch: jest.fn(), post: jest.fn(), delete: jest.fn() },
}));

jest.mock('../../../../../lib/auth/AuthContext', () => ({
  useAuth: jest.fn(),
}));

// Explicit factory: the real module pulls in a native crypto module Jest can't load (same
// mock as `me.test.tsx`).
jest.mock('../../../../../lib/downloads/useDownloads', () => ({ useDownloads: jest.fn() }));

// In-memory stand-in for the SQLite store behind both the playback and theme preferences.
jest.mock('expo-sqlite/kv-store', () => {
  let store: Record<string, string> = {};
  return {
    AsyncStorage: {
      getItem: jest.fn(async (key: string) => store[key] ?? null),
      setItem: jest.fn(async (key: string, value: string) => {
        store[key] = value;
      }),
      __reset: () => {
        store = {};
      },
    },
  };
});

jest.mock('@expo/vector-icons');
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('expo-image-picker', () => ({
  requestCameraPermissionsAsync: jest.fn(async () => ({ granted: true })),
  requestMediaLibraryPermissionsAsync: jest.fn(async () => ({ granted: true })),
  launchCameraAsync: jest.fn(async () => ({ canceled: true, assets: [] })),
  launchImageLibraryAsync: jest.fn(async () => ({ canceled: true, assets: [] })),
}));

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
}));

const mockedGet = api.get as jest.Mock;
const mockedUseAuth = useAuth as jest.Mock;
const mockedUseDownloads = useDownloads as jest.Mock;
const kv = () => jest.requireMock('expo-sqlite/kv-store').AsyncStorage;

const profile = {
  id: 'user-1',
  email: 'ada@example.com',
  full_name: 'Ada Nwosu',
  first_name: 'Ada',
  last_name: 'Nwosu',
  gender: null,
  avatar_url: null,
  role: 'member',
  is_active: true,
  created_at: '2024-01-01T00:00:00Z',
  activated_at: '2024-01-02T00:00:00Z',
  comments_terms_accepted_at: null,
};

let settings: Record<string, unknown> | null = null;

function mockRoutes() {
  mockedGet.mockImplementation((path: string) => {
    if (path === '/auth/me') return Promise.resolve(profile);
    if (path === '/settings/public' && settings) return Promise.resolve(settings);
    return Promise.reject(new Error(`unexpected path: ${path}`));
  });
}

let shownScheme = '';
function SchemeProbe() {
  shownScheme = useTheme().scheme;
  return null;
}

function renderYou() {
  mockRoutes();
  const client = createTestQueryClient();
  return render(
    <ThemeProvider>
      <QueryClientProvider client={client}>
        <SignatureYouScreen />
        <SchemeProbe />
      </QueryClientProvider>
    </ThemeProvider>,
  );
}

const setWifiOnly = jest.fn();
const signOut = jest.fn();

beforeEach(() => {
  mockedGet.mockReset();
  mockPush.mockClear();
  setWifiOnly.mockClear();
  signOut.mockClear();
  settings = null;
  kv().__reset();
  kv().setItem.mockClear();
  jest.spyOn(RN, 'useColorScheme').mockReturnValue('dark');
  mockedUseAuth.mockReturnValue({ signIn: jest.fn(), register: jest.fn(), forgotPassword: jest.fn(), signOut });
  mockedUseDownloads.mockReturnValue({
    downloads: [],
    isLoading: false,
    wifiOnly: true,
    isSavingWifiOnly: false,
    setWifiOnly,
    download: jest.fn(),
    retry: jest.fn(),
    remove: jest.fn(),
    find: jest.fn(),
  });
});
afterEach(() => jest.restoreAllMocks());

describe('SignatureYouScreen', () => {
  it('keeps every existing setting, grouped as the mockup draws it', async () => {
    const screen = renderYou();
    await screen.findByText('ada@example.com');

    expect(screen.getByText('Ada Nwosu')).toBeTruthy();
    expect(screen.getByText("Shown as 'Ada N.' on comments.")).toBeTruthy();
    expect(screen.getByText('Edit profile')).toBeTruthy();
    expect(screen.getByLabelText('Change profile picture')).toBeTruthy();
    for (const heading of ['APPEARANCE', 'PLAYBACK & DOWNLOADS', 'LIBRARY', 'HELP & SAFETY']) {
      expect(screen.getByText(heading)).toBeTruthy();
    }
    expect(screen.getByLabelText('Autoplay next in series')).toBeTruthy();
    expect(screen.getByLabelText('Wi-Fi only downloads')).toBeTruthy();
    expect(screen.getByText('Announcements')).toBeTruthy();
    expect(screen.getByText('Blocked users')).toBeTruthy();
    expect(screen.getByText('Comment guidelines')).toBeTruthy();
    expect(screen.getByText('Sign out')).toBeTruthy();
  });

  it('switches the theme three ways and saves the choice', async () => {
    const screen = renderYou();
    await screen.findByText('ada@example.com');
    await waitFor(() => expect(kv().getItem).toHaveBeenCalledWith('rhemapod-theme-preference'));

    expect(screen.getByText('APPEARANCE')).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'System' }).props.accessibilityState).toEqual({ checked: true });
    expect(shownScheme).toBe('dark');

    await act(async () => {
      fireEvent.press(screen.getByRole('radio', { name: 'Light' }));
    });
    expect(screen.getByRole('radio', { name: 'Light' }).props.accessibilityState).toEqual({ checked: true });
    expect(kv().setItem).toHaveBeenCalledWith('rhemapod-theme-preference', 'light');
    // The page re-renders in the light palette without losing anything.
    expect(shownScheme).toBe('light');
    expect(screen.getByText('ada@example.com')).toBeTruthy();

    await act(async () => {
      fireEvent.press(screen.getByRole('radio', { name: 'Dark' }));
    });
    expect(kv().setItem).toHaveBeenLastCalledWith('rhemapod-theme-preference', 'dark');
    expect(shownScheme).toBe('dark');
  });

  it('reverts the theme and says so when the save fails', async () => {
    const screen = renderYou();
    await screen.findByText('ada@example.com');
    await waitFor(() => expect(kv().getItem).toHaveBeenCalledWith('rhemapod-theme-preference'));

    kv().setItem.mockRejectedValueOnce(new Error('disk full'));
    await act(async () => {
      fireEvent.press(screen.getByRole('radio', { name: 'Light' }));
    });
    expect(screen.getByRole('radio', { name: 'System' }).props.accessibilityState).toEqual({ checked: true });
    expect(await screen.findByText("Couldn't save your appearance setting. Try again.")).toBeTruthy();
  });

  it('flips autoplay and Wi-Fi-only downloads', async () => {
    const screen = renderYou();
    await screen.findByText('ada@example.com');

    expect(screen.getByLabelText('Autoplay next in series').props.accessibilityState.checked).toBe(true);
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Autoplay next in series'));
    });
    expect(screen.getByLabelText('Autoplay next in series').props.accessibilityState.checked).toBe(false);

    fireEvent.press(screen.getByLabelText('Wi-Fi only downloads'));
    expect(setWifiOnly).toHaveBeenCalledWith(false);
  });

  it('reverts autoplay and shows why when the save fails', async () => {
    const screen = renderYou();
    await screen.findByText('ada@example.com');

    kv().setItem.mockRejectedValueOnce(new Error('disk full'));
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Autoplay next in series'));
    });
    expect(screen.getByLabelText('Autoplay next in series').props.accessibilityState.checked).toBe(true);
    expect(await screen.findByText("Couldn't save your playback settings. Try again.")).toBeTruthy();
  });

  it('opens the library rows, the guidelines and the edit sheet, and signs out', async () => {
    const screen = renderYou();
    await screen.findByText('ada@example.com');

    fireEvent.press(screen.getByText('Announcements'));
    expect(mockPush).toHaveBeenCalledWith('/(tabs)/announcements');
    fireEvent.press(screen.getByText('Blocked users'));
    expect(mockPush).toHaveBeenCalledWith('/blocked-users');

    fireEvent.press(screen.getByText('Comment guidelines'));
    expect(await screen.findByText(/RhemaPod Comment Guidelines/)).toBeTruthy();

    fireEvent.press(screen.getByLabelText('Edit profile'));
    expect((await screen.findByLabelText('First name')).props.value).toBe('Ada');

    fireEvent.press(screen.getByLabelText('Sign out'));
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it('mails the contact address, and shows the legal links only once they are set', async () => {
    const openURL = jest.spyOn(RN.Linking, 'openURL').mockResolvedValue(true);
    let screen = renderYou();
    fireEvent.press(await screen.findByLabelText(`Contact us at ${CONTACT_EMAIL}`));
    expect(openURL).toHaveBeenCalledWith(`mailto:${CONTACT_EMAIL}`);
    expect(screen.queryByText('Terms of use')).toBeNull();
    expect(screen.queryByText('Privacy policy')).toBeNull();
    screen.unmount();

    settings = {
      contact_email: 'hello@wateredgarden.org',
      comment_guidelines: 'Guidelines\n\nBe kind.',
      terms_of_use_url: 'https://wateredgarden.org/terms',
      privacy_policy_url: 'https://wateredgarden.org/privacy',
    };
    screen = renderYou();
    fireEvent.press(await screen.findByText('Terms of use'));
    expect(openURL).toHaveBeenCalledWith('https://wateredgarden.org/terms');
    fireEvent.press(screen.getByText('Privacy policy'));
    expect(openURL).toHaveBeenCalledWith('https://wateredgarden.org/privacy');
  });
});
