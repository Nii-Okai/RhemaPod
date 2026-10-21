import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { QueryClientProvider } from '@tanstack/react-query';
import { SignatureHomeScreen } from '../SignatureHome';
import { api } from '../../../../../lib/api/typedClient';
import { createTestQueryClient } from '../../../../../lib/query/testUtils';
import { ThemeProvider } from '../../../../../theme/ThemeContext';

jest.mock('../../../../../lib/api/typedClient', () => ({
  api: { get: jest.fn(), post: jest.fn() },
}));

jest.mock('@expo/vector-icons');

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('../../../../../lib/settings/themePreference', () => ({
  DEFAULT_THEME_PREFERENCE: 'system',
  loadThemePreference: jest.fn(() => Promise.resolve('light')),
  saveThemePreference: jest.fn(() => Promise.resolve()),
}));

// The breathing flame loops forever; a still one keeps the tests' timers quiet.
jest.mock('../Flame', () => {
  const actual = jest.requireActual('../Flame');
  return { ...actual, GlowingFlame: actual.Flame };
});

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
}));

const mockedGet = api.get as jest.Mock;

const sermon = (id: string, title: string, extra: object = {}) => ({
  id,
  title,
  duration_seconds: 1800,
  thumbnail_url: null,
  category_name: 'Faith',
  ...extra,
});

const routes: Record<string, unknown> = {
  '/verses/today': { text: 'O taste and see that the LORD is good', reference: 'Psalms 34:8', translation: 'kjv' },
  '/catalog/sermons/hero': [sermon('h1', 'God the Holy Spirit', { speaker_name: 'Prophet Prince Manasseh Atsu' })],
  '/me/continue-watching': [
    sermon('e2', 'Divine Patterns · Part 2', {
      series_id: 'se1',
      series_title: 'Divine Patterns',
      episode_number: 2,
      position_seconds: 600,
      percent_complete: 33,
    }),
  ],
  '/catalog/sermons/new-releases': [sermon('n1', 'Sunday Service')],
  '/catalog/sermons/prophets-catalog': [
    sermon('p1', 'The Passion of the Holy Spirit', { speaker_id: 'sp1', speaker_name: 'Prophet Prince Manasseh Atsu' }),
    sermon('p2', 'The Word Life', { speaker_id: 'sp1', speaker_name: 'Prophet Prince Manasseh Atsu' }),
  ],
  '/me/recommended': [sermon('r1', 'The Glory')],
  '/catalog/sermons/trending': [sermon('t1', 'The Anointing Within'), sermon('t2', 'Sunday Service Again')],
  '/series': [
    { id: 'se1', title: 'Divine Patterns', episode_count: 4, thumbnail_url: null },
    { id: 'se2', title: 'The Eyes to See', episode_count: 2, thumbnail_url: null },
  ],
  '/series/{series_id}/episodes': [1, 2, 3, 4].map((n) => ({ id: `e${n}`, title: `Part ${n}`, episode_number: n })),
  '/me/history': [{ sermon_id: 'e1', completed: true }],
};

function renderSignature(overrides: Record<string, unknown> = {}) {
  mockedGet.mockImplementation((path: string) => {
    const table = { ...routes, ...overrides };
    if (path in table) {
      const value = table[path];
      return value instanceof Error ? Promise.reject(value) : Promise.resolve(value);
    }
    return Promise.resolve([]);
  });
  const client = createTestQueryClient();
  return render(
    <ThemeProvider lightModeAvailable>
      <QueryClientProvider client={client}>
        <SignatureHomeScreen />
      </QueryClientProvider>
    </ThemeProvider>,
  );
}

beforeEach(() => {
  mockedGet.mockReset();
  mockPush.mockClear();
});

describe('SignatureHomeScreen', () => {
  it('renders every section in the approved order', async () => {
    const screen = renderSignature();
    await screen.findByLabelText('Watch God the Holy Spirit, 30:00');
    await screen.findByText('VERSE OF THE DAY');
    await screen.findByLabelText(/^Divine Patterns\. Continue: Part 2\./);

    const headings = [
      'Pick up where you left off',
      'New releases',
      'Series',
      'Prophet’s Catalog',
      'Recommended for you',
      'Trending',
    ];
    for (const heading of headings) expect(screen.getByText(heading)).toBeTruthy();
    expect(screen.getByLabelText("The Passion of the Holy Spirit, Prophet's Pick")).toBeTruthy();
    expect(screen.getByLabelText('Number 2 trending, Sunday Service Again')).toBeTruthy();
  });

  it('shows the walk for the series in progress and leaves that series out of the grid', async () => {
    const screen = renderSignature();
    const walk = await screen.findByLabelText(
      'Divine Patterns. Continue: Part 2. 1 of 4 parts finished, part 2 in progress',
    );
    expect(screen.getByText('2 OF 4 · 20:00 LEFT')).toBeTruthy();
    expect(screen.getByLabelText('The Eyes to See, 2 episodes')).toBeTruthy();
    expect(screen.queryByLabelText('Divine Patterns, 4 episodes')).toBeNull();

    fireEvent.press(walk);
    expect(mockPush).toHaveBeenLastCalledWith({ pathname: '/series/[id]', params: { id: 'se1' } });
    fireEvent.press(screen.getByLabelText('Resume Divine Patterns · Part 2'));
    expect(mockPush).toHaveBeenLastCalledWith({ pathname: '/sermon/[id]', params: { id: 'e2' } });
  });

  it("opens the prophet's page from the catalog header", async () => {
    const screen = renderSignature();
    fireEvent.press(await screen.findByLabelText('Prophet\'s Catalog'));
    expect(mockPush).toHaveBeenLastCalledWith({
      pathname: '/speaker/[id]',
      params: { id: 'sp1', name: 'Prophet Prince Manasseh Atsu' },
    });
  });

  it('hides empty shelves and the walk when nothing in progress belongs to a series', async () => {
    const screen = renderSignature({ '/me/continue-watching': [], '/me/recommended': [] });
    await screen.findByText('Trending');
    expect(screen.queryByText('Pick up where you left off')).toBeNull();
    expect(screen.queryByText('Recommended for you')).toBeNull();
    expect(screen.queryByLabelText(/Continue: Part/)).toBeNull();
    expect(screen.getByLabelText('Divine Patterns, 4 episodes')).toBeTruthy();
    expect(mockedGet).not.toHaveBeenCalledWith('/me/history', expect.anything());
  });

  it('offers a retry when a shelf fails', async () => {
    const screen = renderSignature({ '/catalog/sermons/new-releases': new Error('boom') });
    await screen.findByText('New releases');
    expect(await screen.findByText('Retry')).toBeTruthy();
  });
});
