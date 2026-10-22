import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { QueryClientProvider } from '@tanstack/react-query';
import { SignatureAnnouncementsScreen } from '../SignatureAnnouncements';
import { api } from '../../../../lib/api/typedClient';
import { createTestQueryClient } from '../../../../lib/query/testUtils';
import { ThemeProvider } from '../../../../theme/ThemeContext';

jest.mock('../../../../lib/api/typedClient', () => ({
  api: { get: jest.fn() },
}));

jest.mock('@expo/vector-icons');

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const mockLoadTheme = jest.fn(() => Promise.resolve('dark'));
jest.mock('../../../../lib/settings/themePreference', () => ({
  DEFAULT_THEME_PREFERENCE: 'system',
  loadThemePreference: () => mockLoadTheme(),
  saveThemePreference: jest.fn(() => Promise.resolve()),
}));

const mockBack = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ back: mockBack }),
}));

const mockedGet = api.get as jest.Mock;
const at = (y: number, m: number, d: number) => new Date(y, m - 1, d, 12).toISOString();
const thisYear = new Date().getFullYear();

const LONG = 'Ten nights of worship and the Word with Prophet Prince Manasseh Atsu and guests. '.repeat(3);

const announcement = (id: string, title: string, extra: object = {}) => ({
  id,
  title,
  description: null,
  image_url: null,
  pinned: false,
  publish_at: null,
  expires_at: null,
  created_at: at(thisYear, 10, 1),
  ...extra,
});

// Unpinned first on purpose: the screen re-sorts pinned-first itself.
const list = [
  announcement('a1', 'Gospel Explo 2026', { description: '1st–3rd April, UPSA Main Auditorium.' }),
  announcement('a2', 'Jesus Festival', {
    pinned: true,
    image_url: 'https://cdn.example.com/festival.jpg',
    publish_at: at(thisYear, 10, 25),
    expires_at: at(thisYear, 11, 3),
    description: LONG,
  }),
];

function renderScreen(items: unknown[] = list, theme: 'dark' | 'light' = 'dark') {
  mockLoadTheme.mockImplementation(() => Promise.resolve(theme));
  mockedGet.mockImplementation((path: string) => {
    if (path === '/announcements') return Promise.resolve(items);
    throw new Error(`unexpected path: ${path}`);
  });
  return render(
    <ThemeProvider>
      <QueryClientProvider client={createTestQueryClient()}>
        <SignatureAnnouncementsScreen />
      </QueryClientProvider>
    </ThemeProvider>,
  );
}

beforeEach(() => {
  mockedGet.mockReset();
  mockBack.mockClear();
});

describe('SignatureAnnouncementsScreen', () => {
  it.each(['dark', 'light'] as const)('puts pinned first, under its own label, with dates (%s)', async (theme) => {
    const screen = renderScreen(list, theme);
    expect(await screen.findByText('Jesus Festival')).toBeTruthy();
    expect(screen.getByText('2 LIVE')).toBeTruthy();
    expect(screen.getByText('PINNED')).toBeTruthy();
    expect(screen.getByText('LATEST')).toBeTruthy();
    expect(screen.getByText('PINNED  ·  25 OCT – 3 NOV')).toBeTruthy();
    // No dates at all: falls back to when it was posted, never "— → —".
    expect(screen.getByText('POSTED 1 OCT')).toBeTruthy();
    const titles = screen.getAllByText(/^(Jesus Festival|Gospel Explo 2026)$/).map((node) => node.props.children);
    expect(titles).toEqual(['Jesus Festival', 'Gospel Explo 2026']);
  });

  it('leaves out section labels when everything is one kind', async () => {
    const screen = renderScreen([list[0]]);
    expect(await screen.findByText('Gospel Explo 2026')).toBeTruthy();
    expect(screen.queryByText('LATEST')).toBeNull();
    expect(screen.getByText('1 LIVE')).toBeTruthy();
  });

  it('clamps a long description and opens it on tap', async () => {
    const screen = renderScreen();
    fireEvent.press(await screen.findByText('Read more'));
    expect(screen.getByText('Show less')).toBeTruthy();
    // The short description never offers it.
    expect(screen.getAllByText(/^(Read more|Show less)$/)).toHaveLength(1);
  });

  it('opens the poster full screen and closes it', async () => {
    const screen = renderScreen();
    fireEvent.press(await screen.findByLabelText('View poster: Jesus Festival'));
    expect(screen.getByLabelText('Poster: Jesus Festival')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Close poster'));
    expect(screen.queryByLabelText('Poster: Jesus Festival')).toBeNull();
  });

  it('shows the empty state and goes back', async () => {
    const screen = renderScreen([]);
    expect(await screen.findByText('No announcements right now')).toBeTruthy();
    expect(screen.queryByText(/LIVE$/)).toBeNull();
    fireEvent.press(screen.getByLabelText('Back'));
    expect(mockBack).toHaveBeenCalledTimes(1);
  });
});
