import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClientProvider } from '@tanstack/react-query';
import { SignatureNotificationsScreen } from '../SignatureNotifications';
import { api } from '../../../lib/api/typedClient';
import { createTestQueryClient } from '../../../lib/query/testUtils';
import { ThemeProvider } from '../../../theme/ThemeContext';

jest.mock('../../../lib/api/typedClient', () => ({
  api: { get: jest.fn() },
}));

jest.mock('@expo/vector-icons');

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const mockLoadTheme = jest.fn(() => Promise.resolve('dark'));
jest.mock('../../../lib/settings/themePreference', () => ({
  DEFAULT_THEME_PREFERENCE: 'system',
  loadThemePreference: () => mockLoadTheme(),
  saveThemePreference: jest.fn(() => Promise.resolve()),
}));

const mockBack = jest.fn();
const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: mockBack }),
}));

const mockedGetItem = jest.fn<Promise<string | null>, [string]>(async () => null);
const mockedSetItem = jest.fn<Promise<undefined>, [string, string]>(async () => undefined);
jest.mock('expo-sqlite/kv-store', () => ({
  AsyncStorage: {
    getItem: (key: string) => mockedGetItem(key),
    setItem: (key: string, value: string) => mockedSetItem(key, value),
  },
}));

const mockedGet = api.get as jest.Mock;
const HOUR = 60 * 60 * 1000;

// Pin "now" to mid-afternoon local time so "2h ago" stays on the same calendar day; run
// between midnight and 2am it became YESTERDAY. Only Date is faked: real timers keep the
// queries and findBy* polling working.
const NOW = new Date(2026, 9, 21, 15, 0);
jest.useFakeTimers({
  now: NOW,
  doNotFake: [
    'hrtime',
    'nextTick',
    'performance',
    'queueMicrotask',
    'requestAnimationFrame',
    'cancelAnimationFrame',
    'requestIdleCallback',
    'cancelIdleCallback',
    'setImmediate',
    'clearImmediate',
    'setInterval',
    'clearInterval',
    'setTimeout',
    'clearTimeout',
  ],
});
afterAll(() => jest.useRealTimers());

const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

const sermon = (id: string, title: string, publishAt: string, extra: object = {}) => ({
  id,
  title,
  thumbnail_url: null,
  duration_seconds: 6480,
  category_name: 'Ministry',
  publish_at: publishAt,
  ...extra,
});

const releases = [
  sermon('s1', 'Sunday Service', ago(2 * HOUR)),
  sermon('s2', 'God the Holy Spirit', ago(26 * HOUR), { category_name: 'Holy Spirit' }),
  sermon('s3', 'Steps to Glory', ago(20 * 24 * HOUR), { category_name: 'Grace' }),
];

function renderScreen(list: unknown[] = releases, theme: 'dark' | 'light' = 'dark') {
  mockLoadTheme.mockImplementation(() => Promise.resolve(theme));
  mockedGet.mockImplementation((path: string) => {
    if (path === '/catalog/sermons/new-releases') return Promise.resolve(list);
    if (path === '/auth/me') return Promise.resolve({ id: 'user-1' });
    throw new Error(`unexpected path: ${path}`);
  });
  return render(
    <ThemeProvider>
      <QueryClientProvider client={createTestQueryClient()}>
        <SignatureNotificationsScreen />
      </QueryClientProvider>
    </ThemeProvider>,
  );
}

beforeEach(() => {
  mockedGet.mockReset();
  mockedGetItem.mockReset();
  mockedGetItem.mockResolvedValue(null);
  mockedSetItem.mockClear();
  mockBack.mockClear();
  mockPush.mockClear();
});

describe('SignatureNotificationsScreen', () => {
  it.each(['dark', 'light'] as const)('features the newest release, then New and Earlier (%s)', async (theme) => {
    const screen = renderScreen(releases, theme);
    expect(await screen.findByLabelText('Sunday Service, Ministry · 1:48:00, unread')).toBeTruthy();
    expect(screen.getByText('Just released · 2h ago')).toBeTruthy();
    expect(screen.getByText('3 NEW')).toBeTruthy();
    expect(screen.getByText('NEW')).toBeTruthy();
    expect(screen.getByText('EARLIER')).toBeTruthy();
    expect(screen.getByLabelText('God the Holy Spirit, unread')).toBeTruthy();
    expect(screen.getByLabelText('Steps to Glory, unread')).toBeTruthy();
  });

  it('opens a sermon and marks it read', async () => {
    const screen = renderScreen();
    fireEvent.press(await screen.findByLabelText('God the Holy Spirit, unread'));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/sermon/[id]', params: { id: 's2' } });
    expect(await screen.findByLabelText('God the Holy Spirit')).toBeTruthy();
    expect(screen.getByText('2 NEW')).toBeTruthy();
    await waitFor(() =>
      expect(mockedSetItem).toHaveBeenCalledWith('rhemapod-notifications-read:user-1', JSON.stringify(['s2'])),
    );
  });

  it('marks everything read at once', async () => {
    const screen = renderScreen();
    fireEvent.press(await screen.findByText('Mark all read'));
    expect(await screen.findByLabelText('Sunday Service, Ministry · 1:48:00')).toBeTruthy();
    expect(screen.queryByText(/^\d+ NEW$/)).toBeNull();
    expect(screen.queryByLabelText(/, unread$/)).toBeNull();
    await waitFor(() =>
      expect(mockedSetItem).toHaveBeenCalledWith(
        'rhemapod-notifications-read:user-1',
        JSON.stringify(['s1', 's2', 's3']),
      ),
    );
  });

  it('leaves out an empty section and says when an old release is only the latest', async () => {
    const screen = renderScreen([sermon('s3', 'Steps to Glory', ago(20 * 24 * HOUR)), releases[2]]);
    expect(await screen.findByText(/^Latest release · /)).toBeTruthy();
    expect(screen.queryByText('NEW')).toBeNull();
  });

  it('shows the empty state and goes back', async () => {
    const screen = renderScreen([]);
    expect(await screen.findByText('Nothing new yet')).toBeTruthy();
    expect(screen.queryByText('Mark all read')).toBeNull();
    fireEvent.press(screen.getByLabelText('Back'));
    expect(mockBack).toHaveBeenCalledTimes(1);
  });
});
