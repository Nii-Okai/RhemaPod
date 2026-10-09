import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { QueryClientProvider } from '@tanstack/react-query';
import { Linking } from 'react-native';
import MeScreen from '../me';
import { api } from '../../../lib/api/typedClient';
import { ApiError } from '../../../lib/api/errors';
import { CONTACT_EMAIL } from '../../../lib/content/commentsCompliance';
import { useAuth } from '../../../lib/auth/AuthContext';
import { createTestQueryClient } from '../../../lib/query/testUtils';

jest.mock('../../../lib/api/typedClient', () => ({
  api: { get: jest.fn(), patch: jest.fn(), post: jest.fn(), delete: jest.fn() },
}));

jest.mock('../../../lib/auth/AuthContext', () => ({
  useAuth: jest.fn(),
}));

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

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
}));

const mockedGet = api.get as jest.Mock;
const mockedPatch = api.patch as jest.Mock;
const mockedUseAuth = useAuth as jest.Mock;

let profile: {
  id: string;
  email: string;
  full_name: string | null;
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
});

describe('MeScreen — layout', () => {
  it('renders the avatar/name/email, playback section, library rows, and the announcements row', async () => {
    mockRoutes();
    const { getByText, findByText, queryByText, getByTestId } = renderMeScreen();

    await findByText('ada@example.com');
    expect(getByText('Playback')).toBeTruthy();
    expect(getByText('Blocked users')).toBeTruthy();
    expect(getByText('History')).toBeTruthy();
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

  it('navigates to Blocked users, /history, and the Announcements tab from their rows', async () => {
    mockRoutes();
    const { getByText, findByText } = renderMeScreen();
    await findByText('ada@example.com');

    fireEvent.press(getByText('Blocked users'));
    expect(mockPush).toHaveBeenCalledWith('/blocked-users');

    fireEvent.press(getByText('History'));
    expect(mockPush).toHaveBeenCalledWith('/history');

    fireEvent.press(getByText('Announcements'));
    expect(mockPush).toHaveBeenCalledWith('/(tabs)/announcements');
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
});

describe('MeScreen — name edit', () => {
  it('shows the current name and how it appears on comments', async () => {
    mockRoutes();
    const { findByLabelText, getByText } = renderMeScreen();
    expect(await findByLabelText('Name, Ada Nwosu')).toBeTruthy();
    expect(getByText("Shown as 'Ada N.' on comments.")).toBeTruthy();
  });

  it('prompts to add a name when blank', async () => {
    profile = { ...profile, full_name: null };
    mockRoutes();
    const { findByLabelText } = renderMeScreen();
    expect(await findByLabelText('Name, Add your name')).toBeTruthy();
  });

  it('saves a new name through PATCH /auth/me, refreshes the profile, and confirms', async () => {
    mockRoutes();
    mockedPatch.mockImplementation(async (_path: string, opts: { body: { full_name: string } }) => {
      profile = { ...profile, full_name: opts.body.full_name };
      return profile;
    });
    const { findByLabelText, getByLabelText, getByText, findByText } = renderMeScreen();

    fireEvent.press(await findByLabelText('Name, Ada Nwosu'));
    const field = await findByLabelText('Full name');
    await act(async () => {
      fireEvent.changeText(field, 'Ada Obi');
    });
    expect(getByText("You'll appear as Ada O.")).toBeTruthy();
    await act(async () => {
      fireEvent.press(getByText('Save'));
    });

    expect(mockedPatch).toHaveBeenCalledWith('/auth/me', { body: { full_name: 'Ada Obi' } });
    expect(await findByText('Name updated.')).toBeTruthy();
    expect(await findByText("Shown as 'Ada O.' on comments.")).toBeTruthy();
    expect(getByLabelText('Name, Ada Obi')).toBeTruthy();
  });

  it('shows the server\'s generic rejection and keeps the old name', async () => {
    mockRoutes();
    mockedPatch.mockRejectedValue(new ApiError(422, "This name can't be used"));
    const { findByLabelText, getByText, findByText } = renderMeScreen();

    fireEvent.press(await findByLabelText('Name, Ada Nwosu'));
    await act(async () => {
      fireEvent.changeText(await findByLabelText('Full name'), 'Pastor Ada');
    });
    await act(async () => {
      fireEvent.press(getByText('Save'));
    });

    expect(await findByText("This name can't be used")).toBeTruthy();
    expect(getByText("Shown as 'Ada N.' on comments.")).toBeTruthy();
  });

  it('explains the 5-per-hour limit on a 429', async () => {
    mockRoutes();
    mockedPatch.mockRejectedValue(new ApiError(429, 'Too many requests'));
    const { findByLabelText, getByText, findByText } = renderMeScreen();

    fireEvent.press(await findByLabelText('Name, Ada Nwosu'));
    await act(async () => {
      fireEvent.changeText(await findByLabelText('Full name'), 'Ada Obi');
    });
    await act(async () => {
      fireEvent.press(getByText('Save'));
    });
    expect(await findByText("You've changed your name too many times. Try again later.")).toBeTruthy();
  });
});

describe('MeScreen — help and safety', () => {
  it('shows the contact address (a flagged placeholder until I1 is supplied) and never opens a mailto: for it', async () => {
    mockRoutes();
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    const { findByLabelText, getByText } = renderMeScreen();

    expect(getByText('Help and safety')).toBeTruthy();
    fireEvent.press(await findByLabelText(`Contact us at ${CONTACT_EMAIL}`));
    expect(openURL).not.toHaveBeenCalled();
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
