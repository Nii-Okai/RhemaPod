import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClientProvider } from '@tanstack/react-query';
import { DailyRhemaCard } from '../DailyRhemaCard';
import { api } from '../../../../../lib/api/typedClient';
import { createTestQueryClient } from '../../../../../lib/query/testUtils';
import { ThemeProvider } from '../../../../../theme/ThemeContext';
import { localDate } from '../../../../../lib/devotionals/dates';

jest.mock('../../../../../lib/api/typedClient', () => ({ api: { get: jest.fn() } }));
jest.mock('@expo/vector-icons');
jest.mock('../../../../../lib/settings/themePreference', () => ({
  DEFAULT_THEME_PREFERENCE: 'system',
  loadThemePreference: jest.fn(() => Promise.resolve('dark')),
  saveThemePreference: jest.fn(() => Promise.resolve()),
}));
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
      __set: (key: string, value: string) => {
        store[key] = value;
      },
    },
  };
});
const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));

const kv = () =>
  jest.requireMock('expo-sqlite/kv-store').AsyncStorage as { __reset: () => void; __set: (k: string, v: string) => void };
const mockedGet = api.get as jest.Mock;

// Publish hour 0 makes "today" the device's local date at any time of day.
const today = localDate(new Date());
const devotional = {
  id: 'd1',
  date: today,
  source: 'dated',
  title: 'Be still, and know',
  publish_hour: 0,
  passage: { ref: 'Psalm 46:10', translation: 'KJV', text: 'Be still', verses: [{ number: 10, text: 'Be still' }] },
  suggested_word: 'still',
};

function renderCard() {
  return render(
    <QueryClientProvider client={createTestQueryClient()}>
      <ThemeProvider>
        <DailyRhemaCard />
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  kv().__reset();
  mockPush.mockReset();
  mockedGet.mockReset();
});

it("shows today's devotional and opens the flow", async () => {
  mockedGet.mockResolvedValue([devotional]);
  const ui = renderCard();
  expect(await ui.findByText('Be still, and know')).toBeTruthy();
  fireEvent.press(ui.getByText('Begin quiet time'));
  expect(mockPush).toHaveBeenCalledWith({ pathname: '/devotional/[date]', params: { date: today } });
});

it('draws the glass sun: see-through gold with a rim, not a solid disc (Nii, 2026-11-12)', async () => {
  mockedGet.mockResolvedValue([devotional]);
  const ui = renderCard();
  await ui.findByText('Be still, and know');
  expect(ui.getByTestId('daily-rhema-sun')).toBeTruthy();
});

it('picks up at the step reached', async () => {
  kv().__set(
    'rhemapod-devotional-journal',
    JSON.stringify({ [today]: { date: today, word: null, completedAt: null, step: 'ponder', holdUp: [] } }),
  );
  mockedGet.mockResolvedValue([devotional]);
  const ui = renderCard();
  fireEvent.press(await ui.findByText('Continue · Ponder'));
  expect(mockPush).toHaveBeenCalledWith({ pathname: '/devotional/[date]', params: { date: today } });
  expect(ui.getByLabelText('2 of 5 steps: Still, Hear, Ponder, Pray, Carry')).toBeTruthy();
});

it('shrinks to the kept word once today is done', async () => {
  kv().__set(
    'rhemapod-devotional-journal',
    JSON.stringify({ [today]: { date: today, word: 'refuge', completedAt: '2026-11-10T07:00:00Z', step: 'carry', holdUp: [] } }),
  );
  mockedGet.mockResolvedValue([devotional]);
  const ui = renderCard();
  expect(await ui.findByText('refuge')).toBeTruthy();
  expect(ui.getByText('Quiet time done')).toBeTruthy();
  expect(ui.queryByText('Begin quiet time')).toBeNull();
  fireEvent.press(ui.getByLabelText('Quiet time done. You kept the word refuge. Open your word garden.'));
  expect(mockPush).toHaveBeenCalledWith('/devotional/garden');
});

it('renders nothing when there is no devotional', async () => {
  mockedGet.mockResolvedValue([]);
  const ui = renderCard();
  await waitFor(() => expect(mockedGet).toHaveBeenCalled());
  expect(ui.toJSON()).toBeNull();
});
