import { addDays } from '../dates';
import {
  furthestStep,
  gardenOf,
  loadJournal,
  loadOfflineDays,
  mergeDays,
  saveJournal,
  streakOf,
  type Devotional,
  type Journal,
  type JournalEntry,
} from '../storage';

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
      __setRaw: (key: string, value: string) => {
        store[key] = value;
      },
    },
  };
});
const kv = () =>
  jest.requireMock('expo-sqlite/kv-store').AsyncStorage as { __reset: () => void; __setRaw: (k: string, v: string) => void };

const dev = (date: string, title = date) => ({ date, title, id: date }) as unknown as Devotional;
const entry = (date: string, over: Partial<JournalEntry> = {}): JournalEntry => ({
  date,
  devotionalId: date,
  title: 't',
  passageRef: 'Ps 46',
  word: null,
  wordVerse: null,
  journal: '',
  holdUp: [],
  step: 'still',
  completedAt: null,
  updatedAt: '',
  ...over,
});

beforeEach(() => kv().__reset());

describe('offline days', () => {
  it('merges fresh over stored and drops days before keepFrom', () => {
    const merged = mergeDays([dev('2026-11-07'), dev('2026-11-09', 'old')], [dev('2026-11-09', 'new'), dev('2026-11-10')], '2026-11-08');
    expect(merged.map((d) => [d.date, d.title])).toEqual([
      ['2026-11-09', 'new'],
      ['2026-11-10', '2026-11-10'],
    ]);
  });

  it('reads a corrupt blob as empty', async () => {
    kv().__setRaw('rhemapod-devotional-days', '{nope');
    expect(await loadOfflineDays()).toEqual([]);
  });
});

describe('journal', () => {
  it('round-trips', async () => {
    const j: Journal = { '2026-11-10': entry('2026-11-10', { word: 'still' }) };
    await saveJournal(j);
    expect(await loadJournal()).toEqual(j);
  });

  it('never moves the resume point backwards', () => {
    expect(furthestStep('pray', 'hear')).toBe('pray');
    expect(furthestStep('hear', 'carry')).toBe('carry');
  });

  it('lists kept words newest first', () => {
    const j: Journal = {
      '2026-11-08': entry('2026-11-08', { word: 'refuge' }),
      '2026-11-09': entry('2026-11-09'),
      '2026-11-10': entry('2026-11-10', { word: 'still' }),
    };
    expect(gardenOf(j).map((e) => e.word)).toEqual(['still', 'refuge']);
  });

  it('counts a streak that survives until today is over', () => {
    const done = { completedAt: 'x' };
    const j: Journal = {
      '2026-11-07': entry('2026-11-07', done),
      '2026-11-08': entry('2026-11-08', done),
      '2026-11-09': entry('2026-11-09', done),
    };
    expect(streakOf(j, '2026-11-10', addDays)).toBe(3);
    expect(streakOf({ ...j, '2026-11-10': entry('2026-11-10', done) }, '2026-11-10', addDays)).toBe(4);
    expect(streakOf(j, '2026-11-11', addDays)).toBe(0);
  });
});
