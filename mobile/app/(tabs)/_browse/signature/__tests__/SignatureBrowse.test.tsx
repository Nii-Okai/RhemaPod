import React from 'react';
import { StyleSheet } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClientProvider } from '@tanstack/react-query';
import { SignatureBrowseScreen } from '../SignatureBrowse';
import { api } from '../../../../../lib/api/typedClient';
import { createTestQueryClient } from '../../../../../lib/query/testUtils';
import { ThemeProvider } from '../../../../../theme/ThemeContext';
import { darkColors, lightColors } from '../../../../../theme/colors';

jest.mock('../../../../../lib/api/typedClient', () => ({
  api: { get: jest.fn() },
}));

jest.mock('@expo/vector-icons');

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

let mockTheme: 'light' | 'dark' = 'dark';
jest.mock('../../../../../lib/settings/themePreference', () => ({
  DEFAULT_THEME_PREFERENCE: 'system',
  loadThemePreference: jest.fn(() => Promise.resolve(mockTheme)),
  saveThemePreference: jest.fn(() => Promise.resolve()),
}));

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
}));

const mockedGet = api.get as jest.Mock;

const categoryNames = ['Faith', 'Grace', 'Holy Spirit', 'Love', 'Marriage', 'Ministry', 'Prayer'];
const routes: Record<string, unknown> = {
  '/categories': categoryNames.map((name, i) => ({ id: `c${i}`, name, slug: name, sermon_count: i + 1 })),
  '/speakers': [
    {
      id: 'sp1',
      name: 'Prophet Prince Manasseh Atsu',
      bio: 'Lead minister, Watered Garden Church',
      sermon_count: 40,
    },
  ],
  '/catalog/sermons/prophets-catalog': [{ id: 'p1', title: 'The Passion of the Holy Spirit', thumbnail_url: null }],
};

const searchHits = {
  results: [
    {
      id: 's1',
      title: 'God the Holy Spirit',
      category_name: 'Holy Spirit',
      duration_seconds: 4380,
      thumbnail_url: null,
    },
  ],
  series: [{ id: 'se1', title: 'The Liberty of the Spirit', episode_count: 2, thumbnail_url: null }],
  speakers: [],
};

function renderBrowse(overrides: Record<string, unknown> = {}) {
  mockedGet.mockImplementation((path: string, init?: { params?: { query?: { q?: string } } }) => {
    if (path === '/search') {
      const q = init?.params?.query?.q ?? '';
      return Promise.resolve(q.includes('spirit') ? searchHits : { results: [], series: [], speakers: [] });
    }
    const table = { ...routes, ...overrides };
    if (path in table) {
      const value = table[path];
      return value instanceof Error ? Promise.reject(value) : Promise.resolve(value);
    }
    return Promise.resolve([]);
  });
  const client = createTestQueryClient();
  return render(
    <ThemeProvider>
      <QueryClientProvider client={client}>
        <SignatureBrowseScreen />
      </QueryClientProvider>
    </ThemeProvider>,
  );
}

beforeEach(() => {
  mockedGet.mockReset();
  mockPush.mockClear();
  mockTheme = 'dark';
});

describe('SignatureBrowseScreen — nothing typed', () => {
  it('shows the catalog, the first six categories and the single speaker', async () => {
    const screen = renderBrowse();
    await screen.findByText('Faith');
    expect(screen.getByLabelText("Prophet's Catalog collection, opens The Passion of the Holy Spirit")).toBeTruthy();
    expect(screen.getByText('Ministry')).toBeTruthy();
    expect(screen.queryByText('Prayer')).toBeNull();
    expect(screen.getByText('Speaker')).toBeTruthy();
    expect(screen.getByText('Lead minister, Watered Garden Church')).toBeTruthy();

    fireEvent.press(screen.getByLabelText('See more categories'));
    expect(screen.getByText('Prayer')).toBeTruthy();
  });

  it('opens the catalog lead sermon, a category and the speaker', async () => {
    const screen = renderBrowse();
    fireEvent.press(await screen.findByLabelText(/^Prophet's Catalog collection/));
    expect(mockPush).toHaveBeenLastCalledWith({ pathname: '/sermon/[id]', params: { id: 'p1' } });

    fireEvent.press(screen.getByLabelText('Grace, 2 sermons'));
    expect(mockPush).toHaveBeenLastCalledWith({ pathname: '/category/[id]', params: { id: 'c1', name: 'Grace' } });

    fireEvent.press(screen.getByLabelText('Prophet Prince Manasseh Atsu, Lead minister, Watered Garden Church'));
    expect(mockPush).toHaveBeenLastCalledWith({
      pathname: '/speaker/[id]',
      params: {
        id: 'sp1',
        name: 'Prophet Prince Manasseh Atsu',
        bio: 'Lead minister, Watered Garden Church',
        sermonCount: '40',
      },
    });
  });

  it('leaves the catalog card out when the catalog is empty', async () => {
    const screen = renderBrowse({ '/catalog/sermons/prophets-catalog': [] });
    await screen.findByText('Faith');
    expect(screen.queryByLabelText(/^Prophet's Catalog collection/)).toBeNull();
  });

  it('offers a retry when categories fail', async () => {
    const screen = renderBrowse({ '/categories': new Error('boom') });
    expect(await screen.findByText('Retry')).toBeTruthy();
  });

  it.each([
    ['dark', darkColors],
    ['light', lightColors],
  ] as const)('colours the category tiles from the %s palette', async (theme, palette) => {
    mockTheme = theme;
    const screen = renderBrowse();
    await screen.findByText('Faith');
    // Cycles wheat, slate, rose, sage. The saved theme loads asynchronously.
    await waitFor(() =>
      expect(StyleSheet.flatten(screen.getByText('Faith').props.style).color).toBe(palette.status.wheat.dot),
    );
    expect(StyleSheet.flatten(screen.getByText('Grace').props.style).color).toBe(palette.status.slate.text);
    expect(StyleSheet.flatten(screen.getByText('Love').props.style).color).toBe(palette.status.sage.text);
  });
});

describe('SignatureBrowseScreen — searching', () => {
  it('replaces the browse sections with live results', async () => {
    const screen = renderBrowse();
    await screen.findByText('Faith');
    fireEvent.changeText(screen.getByLabelText('Search sermons, series, speakers'), 'spirit');

    expect(await screen.findByText('God the Holy Spirit')).toBeTruthy();
    expect(screen.getByText('SERMON · HOLY SPIRIT · 1:13:00')).toBeTruthy();
    expect(screen.getByText('SERIES · 2 EPISODES')).toBeTruthy();
    expect(screen.queryByText('Categories')).toBeNull();

    fireEvent.press(screen.getByLabelText('The Liberty of the Spirit, series · 2 episodes'));
    expect(mockPush).toHaveBeenLastCalledWith({ pathname: '/series/[id]', params: { id: 'se1' } });
  });

  it('says so when nothing matches, and clearing brings Browse back', async () => {
    const screen = renderBrowse();
    await screen.findByText('Faith');
    fireEvent.changeText(screen.getByLabelText('Search sermons, series, speakers'), 'zzz');

    expect(await screen.findByText('Nothing for “zzz” yet')).toBeTruthy();
    expect(screen.getByText('Try a series name or a category like Faith.')).toBeTruthy();

    fireEvent.press(screen.getByLabelText('Clear search'));
    expect(screen.getByText('Categories')).toBeTruthy();
  });
});
