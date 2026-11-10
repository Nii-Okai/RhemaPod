import { act, renderHook, waitFor } from '@testing-library/react-native';
import { api } from '../../../api/typedClient';
import { fetchDevotionalWindow, useJournal } from '../useDevotionals';
import { loadJournal, type Devotional } from '../../../devotionals/storage';
import { wrapWithQueryClient } from '../../testUtils';

jest.mock('../../../api/typedClient', () => ({ api: { get: jest.fn() } }));
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

const mockedGet = api.get as jest.Mock;
const kv = () => jest.requireMock('expo-sqlite/kv-store').AsyncStorage as { __reset: () => void };

const day = (date: string) =>
  ({
    id: `d-${date}`,
    date,
    title: `Day ${date}`,
    publish_hour: 5,
    passage: { ref: 'Psalm 46:10', translation: 'KJV', text: 'Be still', verses: [{ number: 10, text: 'Be still' }] },
    suggested_word: 'still',
  }) as unknown as Devotional;

const NOW = new Date('2026-11-10T12:00:00Z');

beforeEach(() => {
  mockedGet.mockReset();
  kv().__reset();
});

describe('fetchDevotionalWindow', () => {
  it('asks for the window and keeps it on the phone', async () => {
    mockedGet.mockResolvedValue([day('2026-11-10'), day('2026-11-11')]);
    const days = await fetchDevotionalWindow(NOW, 5);
    expect(mockedGet).toHaveBeenCalledWith(
      '/devotionals/days',
      expect.objectContaining({ params: { query: expect.objectContaining({ count: expect.any(Number) }) } }),
    );
    expect(days.map((d) => d.date)).toEqual(['2026-11-10', '2026-11-11']);
  });

  it('serves the stored week when the network fails', async () => {
    mockedGet.mockResolvedValueOnce([day('2026-11-10'), day('2026-11-11')]);
    await fetchDevotionalWindow(NOW, 5);
    mockedGet.mockRejectedValueOnce(new Error('offline'));
    const days = await fetchDevotionalWindow(new Date('2026-11-11T12:00:00Z'), 5);
    expect(days.map((d) => d.date)).toEqual(['2026-11-10', '2026-11-11']);
  });

  it('rethrows when there is nothing stored', async () => {
    mockedGet.mockRejectedValueOnce(new Error('offline'));
    await expect(fetchDevotionalWindow(NOW, 5)).rejects.toThrow('offline');
  });
});

describe('useJournal', () => {
  it('saves updates through to the phone and keeps the furthest step', async () => {
    const { result } = renderHook(() => useJournal(), { wrapper: wrapWithQueryClient() });
    await waitFor(() => expect(result.current.loaded).toBe(true));
    act(() => result.current.update(day('2026-11-10'), { step: 'pray', word: 'still' }));
    act(() => result.current.update(day('2026-11-10'), { step: 'hear' }));
    await waitFor(() => expect(result.current.journal?.['2026-11-10']).toMatchObject({ step: 'pray', word: 'still' }));
    await waitFor(async () => expect((await loadJournal())['2026-11-10']?.word).toBe('still'));
  });
});
