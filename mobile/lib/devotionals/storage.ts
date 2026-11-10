import { AsyncStorage as SQLiteAsyncStorage } from 'expo-sqlite/kv-store';
import type { components } from '../api/schema';

/**
 * Daily Rhema on-device storage (plan-daily-devotional D2 and D4).
 *
 * Two blobs in the same SQLite-backed key-value store the rest of the app uses:
 *
 * - **Offline days** (`rhemapod-devotional-days`): the last prefetch window, so the week
 *   ahead works with no network (D4). The query cache alone can't do this: it is
 *   persisted for 24 hours only. Days older than yesterday are dropped on every write.
 *   A pastor's reading URL is signed and may expire; playback then falls back to the
 *   text or the phone's voice.
 *
 * - **Journal** (`rhemapod-devotional-journal`): the listener's own kept word, journal
 *   text, "hold someone up" names and progress, one entry per date. Never sent to the
 *   API (D2, ADR 0022 §5). Signing out does not clear it: it belongs to the phone's
 *   owner, like downloads.
 *
 * Reads are defensive: a corrupt blob reads as empty rather than throwing.
 */

export type Devotional = components['schemas']['DevotionalPublic'];

const DAYS_KEY = 'rhemapod-devotional-days';
const JOURNAL_KEY = 'rhemapod-devotional-journal';

export const STEPS = ['still', 'hear', 'ponder', 'pray', 'carry'] as const;
export type Step = (typeof STEPS)[number];

export interface JournalEntry {
  date: string;
  devotionalId: string;
  title: string;
  passageRef: string;
  /** The word the listener kept (theirs, or the suggested one). */
  word: string | null;
  /** The verse text the word came from, for the garden. */
  wordVerse: string | null;
  journal: string;
  holdUp: string[];
  /** The furthest step reached, for resume. */
  step: Step;
  completedAt: string | null;
  updatedAt: string;
}

export type Journal = Record<string, JournalEntry>;

async function readJson<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await SQLiteAsyncStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as T) : fallback;
  } catch {
    return fallback;
  }
}

// ── Offline days ──────────────────────────────────────────────────────────────
export async function loadOfflineDays(): Promise<Devotional[]> {
  const days = await readJson<Devotional[]>(DAYS_KEY, []);
  return Array.isArray(days) ? days.filter((d) => d && typeof d.date === 'string') : [];
}

/** Merge a fresh window over what is stored, keeping only `keepFrom` onwards. */
export function mergeDays(stored: Devotional[], fresh: Devotional[], keepFrom: string): Devotional[] {
  const byDate = new Map<string, Devotional>();
  for (const d of stored) if (d.date >= keepFrom) byDate.set(d.date, d);
  for (const d of fresh) byDate.set(d.date, d);
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export async function saveOfflineDays(days: Devotional[]): Promise<void> {
  try {
    await SQLiteAsyncStorage.setItem(DAYS_KEY, JSON.stringify(days));
  } catch {
    // Best effort: the online path still works without the offline copy.
  }
}

// ── Journal ───────────────────────────────────────────────────────────────────
export async function loadJournal(): Promise<Journal> {
  return readJson<Journal>(JOURNAL_KEY, {});
}

export async function saveJournal(journal: Journal): Promise<void> {
  await SQLiteAsyncStorage.setItem(JOURNAL_KEY, JSON.stringify(journal));
}

export function emptyEntry(dev: Devotional, nowIso: string): JournalEntry {
  return {
    date: dev.date,
    devotionalId: dev.id,
    title: dev.title,
    passageRef: dev.passage.ref,
    word: null,
    wordVerse: null,
    journal: '',
    holdUp: [],
    step: 'still',
    completedAt: null,
    updatedAt: nowIso,
  };
}

/** Never move the resume point backwards when the listener revisits an earlier step. */
export function furthestStep(a: Step, b: Step): Step {
  return STEPS.indexOf(a) >= STEPS.indexOf(b) ? a : b;
}

/** Kept words, newest first, for the word garden. */
export function gardenOf(journal: Journal): JournalEntry[] {
  return Object.values(journal)
    .filter((e) => e.word)
    .sort((a, b) => b.date.localeCompare(a.date));
}

/** Consecutive completed days ending today or yesterday (a streak survives until the day is over). */
export function streakOf(journal: Journal, today: string, addDays: (iso: string, n: number) => string): number {
  let day = journal[today]?.completedAt ? today : addDays(today, -1);
  let n = 0;
  while (journal[day]?.completedAt) {
    n += 1;
    day = addDays(day, -1);
  }
  return n;
}
