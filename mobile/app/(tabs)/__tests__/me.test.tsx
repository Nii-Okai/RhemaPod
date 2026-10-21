import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { QueryClientProvider } from '@tanstack/react-query';
import { Linking } from 'react-native';
import MeScreen from '../me';
import { api } from '../../../lib/api/typedClient';
import { ApiError } from '../../../lib/api/errors';
import { CONTACT_EMAIL } from '../../../lib/content/commentsCompliance';
import { useAuth } from '../../../lib/auth/AuthContext';
import { useDownloads } from '../../../lib/downloads/useDownloads';
import { createTestQueryClient } from '../../../lib/query/testUtils';

jest.mock('../../../lib/api/typedClient', () => ({
  api: { get: jest.fn(), patch: jest.fn(), post: jest.fn(), delete: jest.fn() },
}));

jest.mock('../../../lib/auth/AuthContext', () => ({
  useAuth: jest.fn(),
}));

// Explicit factory (not a bare automock) — an automock still has to `require()` the real
// module first to learn its shape, which for `useDownloads` pulls in `downloadManager.ts`
// -> `modules/rpa-crypto` -> the real native module resolution (unavailable under Jest,
// same gap as every other native-module test in this app — see `downloads.test.tsx`'s
// identical mock).
jest.mock('../../../lib/downloads/useDownloads', () => ({ useDownloads: jest.fn() }));

// The real store is SQLite-backed and doesn't run under Jest — same in-memory
// stand-in `lib/query/__tests__/persister.test.tsx` already established, reused
// here since `usePlaybackPreferences` reads/writes through this exact module.
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

// Explicit factory, not a bare automock, for the same reason every other native module in
// this app's tests gets one — `ProfileAvatarPicker` imports this at module scope, and the
// real module ships ESM the Jest transform doesn't handle (see this mock's own commit for
// the exact failure). No test here exercises an actual pick, so these are never called.
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
const mockedPatch = api.patch as jest.Mock;
const mockedUseAuth = useAuth as jest.Mock;
const mockedUseDownloads = useDownloads as jest.Mock;

let profile: {
  id: string;
  email: string;
  full_name: string | null;
  first_name: string | null;
  last_name: string | null;
  gender: string | null;
  avatar_url: string | null;
  role: string;
  is_active: boolean;
  created_at: string;
  activated_at: string;
  comments_terms_accepted_at: string | null;
};

function mockRoutes() {
  mockedGet.mockImplementation((path: string) => {
    if (path === '/auth/me') return Promise.resolve(profile);
    throw new Error(`unexpected path: ${path}`);
  });
}

function renderMeScreen() {
  const client = createTestQueryClient();
  return render(
    <QueryClientProvider client={client}>
      <MeScreen />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mockedGet.mockReset();
  mockedPatch.mockReset();
  mockPush.mockClear();
  profile = {
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
  jest.requireMock('expo-sqlite/kv-store').AsyncStorage.__reset();
  mockedUseAuth.mockReturnValue({
    signIn: jest.fn(),
    register: jest.fn(),
    forgotPassword: jest.fn(),
    signOut: jest.fn(),
  });
  mockedUseDownloads.mockReturnValue({
    downloads: [],
    isLoading: false,
    wifiOnly: true,
    isSavingWifiOnly: false,
    setWifiOnly: jest.fn(),
    download: jest.fn(),
    retry: jest.fn(),
    remove: jest.fn(),
    find: jest.fn(),
  });
});

describe('MeScreen — layout', () => {
  it('renders the avatar/name/email, playback section, library rows, and the announcements row', async () => {
    mockRoutes();
    const { getByText, findByText, queryByText, getByTestId } = renderMeScreen();

    await findByText('ada@example.com');
    expect(getByText('Playback')).toBeTruthy();
    expect(getByText('Blocked users')).toBeTruthy();
    expect(getByText('Announcements')).toBeTruthy();
    expect(getByText('Sign out')).toBeTruthy();
    expect(getByTestId('me-layout')).toBeTruthy();
    // Notes is gone from the app.
    expect(queryByText('Notes')).toBeNull();
  });

  it('never renders a membership/billing block (plan L1)', async () => {
    mockRoutes();
    const { findByText, queryByText } = renderMeScreen();
    await findByText('ada@example.com');
    expect(queryByText(/membership/i)).toBeNull();
    expect(queryByText(/past due/i)).toBeNull();
  });

  it('navigates to Blocked users and the Announcements tab from their rows', async () => {
    mockRoutes();
    const { getByText, findByText } = renderMeScreen();
    await findByText('ada@example.com');

    fireEvent.press(getByText('Blocked users'));
    expect(mockPush).toHaveBeenCalledWith('/blocked-users');

    fireEvent.press(getByText('Announcements'));
    expect(mockPush).toHaveBeenCalledWith('/(tabs)/announcements');
  });

  it('no longer offers a History row (the page was removed, session 2026-10-16)', async () => {
    mockRoutes();
    const { findByText, queryByText } = renderMeScreen();
    await findByText('ada@example.com');
    expect(queryByText('History')).toBeNull();
  });

  it('calls the per-device sign-out when "Sign out" is pressed', async () => {
    mockRoutes();
    const signOut = jest.fn();
    mockedUseAuth.mockReturnValue({ signIn: jest.fn(), register: jest.fn(), forgotPassword: jest.fn(), signOut });

    const { getByText, findByText } = renderMeScreen();
    await findByText('ada@example.com');

    fireEvent.press(getByText('Sign out'));
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it('applies the autoplay toggle optimistically', async () => {
    mockRoutes();
    const { findByText, getByLabelText } = renderMeScreen();
    await findByText('ada@example.com');

    const toggle = getByLabelText('Autoplay next in series');
    expect(toggle.props.accessibilityState.checked).toBe(true);

    await act(async () => {
      fireEvent.press(toggle);
    });

    expect(getByLabelText('Autoplay next in series').props.accessibilityState.checked).toBe(false);
  });

  it('reverts the toggle and shows an error when the persistence write fails', async () => {
    mockRoutes();
    const { findByText, getByLabelText, queryByText } = renderMeScreen();
    await findByText('ada@example.com');

    jest.requireMock('expo-sqlite/kv-store').AsyncStorage.setItem.mockRejectedValueOnce(new Error('disk full'));

    const toggle = getByLabelText('Autoplay next in series');
    expect(toggle.props.accessibilityState.checked).toBe(true);

    await act(async () => {
      fireEvent.press(toggle);
    });

    // Reverted, not left on the optimistic (failed) value — and the failure is visible,
    // not a silently-swallowed rejection (reviewer-gilfoyle W4.6 must-fix).
    expect(getByLabelText('Autoplay next in series').props.accessibilityState.checked).toBe(true);
    expect(await findByText("Couldn't save your playback settings. Try again.")).toBeTruthy();

    // A subsequent successful change clears the error rather than leaving it stuck.
    await act(async () => {
      fireEvent.press(getByLabelText('Autoplay next in series'));
    });
    expect(queryByText("Couldn't save your playback settings. Try again.")).toBeNull();
  });

  it('shows the Downloads section with the current Wi-Fi-only state, and toggling it calls setWifiOnly (session 2026-10-09 — folded in from the retired standalone downloads-settings page)', async () => {
    const setWifiOnly = jest.fn();
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
    mockRoutes();
    const { findByText, getByLabelText } = renderMeScreen();
    await findByText('ada@example.com');

    const toggle = getByLabelText('Wi-Fi only downloads');
    expect(toggle.props.accessibilityState.checked).toBe(true);

    fireEvent.press(toggle);
    expect(setWifiOnly).toHaveBeenCalledWith(false);
  });
});

describe('MeScreen — profile edit', () => {
  it('shows an Edit profile link and how the current name appears on comments', async () => {
    mockRoutes();
    const { findByText, getByText } = renderMeScreen();
    await findByText('ada@example.com');
    expect(getByText('Edit profile')).toBeTruthy();
    expect(getByText("Shown as 'Ada N.' on comments.")).toBeTruthy();
  });

  it('pre-fills first/last name from the profile, and saves both plus gender through PATCH /auth/me/profile', async () => {
    mockRoutes();
    mockedPatch.mockImplementation(
      async (_path: string, opts: { body: { first_name: string; last_name: string; gender: string | null } }) => {
        profile = {
          ...profile,
          first_name: opts.body.first_name,
          last_name: opts.body.last_name,
          gender: opts.body.gender,
          full_name: `${opts.body.first_name} ${opts.body.last_name}`,
        };
        return profile;
      },
    );
    const { findByText, getByLabelText, getByText, findByLabelText } = renderMeScreen();

    fireEvent.press(await findByText('Edit profile'));
    expect((await findByLabelText('First name')).props.value).toBe('Ada');
    expect(getByLabelText('Last name').props.value).toBe('Nwosu');

    await act(async () => {
      fireEvent.changeText(getByLabelText('First name'), 'Ada');
      fireEvent.changeText(getByLabelText('Last name'), 'Obi');
      fireEvent.press(getByLabelText('Female'));
    });
    await act(async () => {
      fireEvent.press(getByText('Save'));
    });

    expect(mockedPatch).toHaveBeenCalledWith('/auth/me/profile', {
      body: { first_name: 'Ada', last_name: 'Obi', gender: 'female' },
    });
    expect(await findByText('Profile updated.')).toBeTruthy();
    expect(await findByText("Shown as 'Ada O.' on comments.")).toBeTruthy();
  });

  it('disables Save until both first and last name are non-empty', async () => {
    mockRoutes();
    const { findByText, getByLabelText, getByText } = renderMeScreen();

    fireEvent.press(await findByText('Edit profile'));
    await act(async () => {
      fireEvent.changeText(getByLabelText('Last name'), '');
    });
    await act(async () => {
      fireEvent.press(getByText('Save'));
    });

    expect(mockedPatch).not.toHaveBeenCalled();
  });

  it('shows the server\'s generic rejection and leaves the sheet open', async () => {
    mockRoutes();
    mockedPatch.mockRejectedValue(new ApiError(422, "This name can't be used"));
    const { findByText, getByLabelText, getByText, findByText: findByTextAgain } = renderMeScreen();

    fireEvent.press(await findByText('Edit profile'));
    await act(async () => {
      fireEvent.changeText(getByLabelText('First name'), 'Pastor');
    });
    await act(async () => {
      fireEvent.press(getByText('Save'));
    });

    expect(await findByTextAgain("This name can't be used")).toBeTruthy();
    expect(getByText("Shown as 'Ada N.' on comments.")).toBeTruthy();
  });

  it('explains the 5-per-hour limit on a 429', async () => {
    mockRoutes();
    mockedPatch.mockRejectedValue(new ApiError(429, 'Too many requests'));
    const { findByText, getByLabelText, getByText } = renderMeScreen();

    fireEvent.press(await findByText('Edit profile'));
    await act(async () => {
      fireEvent.changeText(getByLabelText('First name'), 'Ada');
    });
    await act(async () => {
      fireEvent.press(getByText('Save'));
    });
    expect(await findByText("You've changed your name too many times. Try again later.")).toBeTruthy();
  });
});

describe('MeScreen — help and safety', () => {
  it('shows the real contact address (I1 shipped 2026-10-16) and opens a mailto: for it', async () => {
    mockRoutes();
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    const { findByLabelText, getByText } = renderMeScreen();

    expect(getByText('Help and safety')).toBeTruthy();
    fireEvent.press(await findByLabelText(`Contact us at ${CONTACT_EMAIL}`));
    expect(openURL).toHaveBeenCalledWith(`mailto:${CONTACT_EMAIL}`);
    openURL.mockRestore();
  });

  it('reopens the comment guidelines read-only, with no agree control', async () => {
    mockRoutes();
    const { findByText, getByText, queryByLabelText, queryByText } = renderMeScreen();
    await findByText('ada@example.com');

    fireEvent.press(getByText('Comment guidelines'));
    expect(await findByText(/RhemaPod Comment Guidelines/)).toBeTruthy();
    expect(queryByLabelText('I agree to the comment guidelines')).toBeNull();
    expect(queryByText('Agree and continue')).toBeNull();
  });
});

// plan-admin-settings S18: contact email and legal links come from GET /settings/public,
// with the shipped constants as fallback.
describe('MeScreen — server settings', () => {
  function mockRoutesWithSettings(settings: Record<string, unknown>) {
    mockedGet.mockImplementation((path: string) => {
      if (path === '/auth/me') return Promise.resolve(profile);
      if (path === '/settings/public') return Promise.resolve(settings);
      throw new Error(`unexpected path: ${path}`);
    });
  }

  const SETTINGS = {
    contact_email: 'hello@wateredgarden.org',
    comment_guidelines: 'Guidelines\n\nBe kind.',
    terms_of_use_url: 'https://wateredgarden.org/terms',
    privacy_policy_url: 'https://wateredgarden.org/privacy',
  };

  it('shows the server contact address and mails it', async () => {
    mockRoutesWithSettings(SETTINGS);
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    const { findByLabelText } = renderMeScreen();
    fireEvent.press(await findByLabelText('Contact us at hello@wateredgarden.org'));
    expect(openURL).toHaveBeenCalledWith('mailto:hello@wateredgarden.org');
    openURL.mockRestore();
  });

  it('opens the server legal links', async () => {
    mockRoutesWithSettings(SETTINGS);
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    const { findByText, getByText } = renderMeScreen();
    fireEvent.press(await findByText('Terms of use'));
    expect(openURL).toHaveBeenCalledWith('https://wateredgarden.org/terms');
    fireEvent.press(getByText('Privacy policy'));
    expect(openURL).toHaveBeenCalledWith('https://wateredgarden.org/privacy');
    openURL.mockRestore();
  });

  it('hides each legal row while its link is not set', async () => {
    mockRoutesWithSettings({ ...SETTINGS, terms_of_use_url: null, privacy_policy_url: null });
    const { findByLabelText, queryByText } = renderMeScreen();
    await findByLabelText('Contact us at hello@wateredgarden.org');
    expect(queryByText('Terms of use')).toBeNull();
    expect(queryByText('Privacy policy')).toBeNull();
  });

  it('never opens a non-https legal link', async () => {
    mockRoutesWithSettings({ ...SETTINGS, terms_of_use_url: 'javascript:alert(1)', privacy_policy_url: null });
    const { findByLabelText, queryByText } = renderMeScreen();
    await findByLabelText('Contact us at hello@wateredgarden.org');
    expect(queryByText('Terms of use')).toBeNull();
  });

  it('falls back to the shipped address when the settings read fails', async () => {
    mockedGet.mockImplementation((path: string) => {
      if (path === '/auth/me') return Promise.resolve(profile);
      return Promise.reject(new Error('Network request failed'));
    });
    const { findByLabelText, queryByText } = renderMeScreen();
    expect(await findByLabelText(`Contact us at ${CONTACT_EMAIL}`)).toBeTruthy();
    expect(queryByText('Terms of use')).toBeNull();
  });
});
