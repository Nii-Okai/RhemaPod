import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClientProvider } from '@tanstack/react-query';
import { Dimensions } from 'react-native';
import MeScreen from '../me';
import { api } from '../../../lib/api/typedClient';
import { useAuth } from '../../../lib/auth/AuthContext';
import { createTestQueryClient } from '../../../lib/query/testUtils';

jest.mock('../../../lib/api/typedClient', () => ({
  api: { get: jest.fn(), delete: jest.fn() },
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

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
}));

const mockedGet = api.get as jest.Mock;
const mockedUseAuth = useAuth as jest.Mock;

const profile = {
  id: 'user-1',
  email: 'ada@example.com',
  full_name: 'Ada Nwosu',
  role: 'member',
  is_active: true,
  created_at: '2024-01-01T00:00:00Z',
  activated_at: '2024-01-02T00:00:00Z',
};

const notes = [
  { id: 'n1', sermon_id: 's1', body: 'A note', position_seconds: 62, created_at: '2026-01-01T00:00:00Z', updated_at: null },
];

function mockRoutes() {
  mockedGet.mockImplementation((path: string) => {
    if (path === '/auth/me') return Promise.resolve(profile);
    if (path === '/me/notes') return Promise.resolve(notes);
    if (path === '/catalog/sermons') return Promise.resolve([]);
    throw new Error(`unexpected path: ${path}`);
  });
}

function setWindowWidth(width: number) {
  act(() => {
    Dimensions.set({
      window: { width, height: 800, scale: 2, fontScale: 1 },
      screen: { width, height: 800, scale: 2, fontScale: 1 },
    });
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
  mockPush.mockClear();
  jest.requireMock('expo-sqlite/kv-store').AsyncStorage.__reset();
  setWindowWidth(375);
  mockedUseAuth.mockReturnValue({
    signIn: jest.fn(),
    register: jest.fn(),
    forgotPassword: jest.fn(),
    signOut: jest.fn(),
  });
});

afterEach(() => {
  setWindowWidth(375);
});

describe('MeScreen — phone layout', () => {
  it('renders the avatar/name/email, playback section, library rows, and the announcements row', async () => {
    mockRoutes();
    const { getByText, findByText, queryByTestId } = renderMeScreen();

    await findByText('Ada Nwosu');
    expect(getByText('ada@example.com')).toBeTruthy();
    expect(getByText('Playback')).toBeTruthy();
    expect(getByText('Notes')).toBeTruthy();
    expect(getByText('History')).toBeTruthy();
    expect(getByText('Announcements')).toBeTruthy();
    expect(getByText('Sign out')).toBeTruthy();
    expect(queryByTestId('me-tablet-layout')).toBeNull();
  });

  it('never renders a membership/billing block (plan L1)', async () => {
    mockRoutes();
    const { findByText, queryByText } = renderMeScreen();
    await findByText('Ada Nwosu');
    expect(queryByText(/membership/i)).toBeNull();
    expect(queryByText(/past due/i)).toBeNull();
  });

  it('navigates to /notes, /history, and the Announcements tab from their rows', async () => {
    mockRoutes();
    const { getByText, findByText } = renderMeScreen();
    await findByText('Ada Nwosu');

    fireEvent.press(getByText('Notes'));
    expect(mockPush).toHaveBeenCalledWith('/notes');

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
    await findByText('Ada Nwosu');

    fireEvent.press(getByText('Sign out'));
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it('applies the autoplay toggle optimistically', async () => {
    mockRoutes();
    const { findByText, getByLabelText } = renderMeScreen();
    await findByText('Ada Nwosu');

    const toggle = getByLabelText('Autoplay next in series');
    expect(toggle.props.accessibilityState.checked).toBe(true);

    await act(async () => {
      fireEvent.press(toggle);
    });

    expect(getByLabelText('Autoplay next in series').props.accessibilityState.checked).toBe(false);
  });
});

describe('MeScreen — tablet two-pane', () => {
  it('renders the settings pane alongside the "Your notes" panel at/above the 768pt breakpoint', async () => {
    mockRoutes();
    setWindowWidth(1024);
    const { findByText, getByTestId, getByText } = renderMeScreen();

    await findByText('Ada Nwosu');
    expect(getByTestId('me-tablet-layout')).toBeTruthy();
    expect(getByTestId('notes-panel')).toBeTruthy();
    await waitFor(() => expect(getByText('A note')).toBeTruthy());
  });

  it('falls back to the single-pane phone layout below the breakpoint', async () => {
    mockRoutes();
    setWindowWidth(375);
    const { findByText, queryByTestId, getByTestId } = renderMeScreen();

    await findByText('Ada Nwosu');
    expect(queryByTestId('me-tablet-layout')).toBeNull();
    expect(getByTestId('me-phone-layout')).toBeTruthy();
  });
});
