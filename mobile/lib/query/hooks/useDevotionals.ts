/**
 * Daily Rhema data (plan-daily-devotional M1).
 *
 * `useDevotionalWindow()` fetches the current devotional date plus the week ahead
 * (`GET /devotionals/days`, public, no auth) and writes it to the on-device offline copy,
 * so the next seven days work with no network (D4). With no network, the offline copy is
 * served instead. A prefetched day is never shown before its date and the church's
 * publish hour (`isUnlocked`).
 *
 * `useJournal()` is the listener's on-device journal (D2), held in the query cache so
 * every screen sees the same copy, with a writer that saves through to storage.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/typedClient';
import { queryKeys } from '../queryClient';
import {
  addDays,
  currentDevotionalDate,
  isUnlocked,
  localDate,
  prefetchWindow,
} from '../../devotionals/dates';
import {
  emptyEntry,
  furthestStep,
  loadJournal,
  loadOfflineDays,
  mergeDays,
  saveJournal,
  saveOfflineDays,
  type Devotional,
  type Journal,
  type JournalEntry,
} from '../../devotionals/storage';

/** Until the first response tells us the church's hour. Matches the server default. */
export const DEFAULT_PUBLISH_HOUR = 5;
const THIRTY_MINUTES = 30 * 60 * 1000;

export async function fetchDevotionalWindow(now: Date, publishHour: number, signal?: RequestInit["signal"]): Promise<Devotional[]> {
  const { from, count } = prefetchWindow(now, publishHour);
  const keepFrom = addDays(localDate(now), -1);
  try {
    const fresh = await api.get('/devotionals/days', {
      params: { query: { from, count } },
      init: { signal },
    });
    const merged = mergeDays(await loadOfflineDays(), fresh, keepFrom);
    await saveOfflineDays(merged);
    return merged;
  } catch (err) {
    const offline = (await loadOfflineDays()).filter((d) => d.date >= keepFrom);
    if (offline.length) return offline;
    throw err;
  }
}

export function useDevotionalWindow(now: Date = new Date()) {
  // The publish hour comes from the data itself; until then assume the server default.
  const [publishHour, setPublishHour] = useState(DEFAULT_PUBLISH_HOUR);
  const current = currentDevotionalDate(now, publishHour);
  const query = useQuery({
    queryKey: queryKeys.devotionals.window(current),
    queryFn: ({ signal }) => fetchDevotionalWindow(new Date(), publishHour, signal),
    staleTime: THIRTY_MINUTES,
    // Run the fetch even offline: its catch serves the on-device week (D4).
    networkMode: 'offlineFirst',
  });
  const hour = query.data?.[0]?.publish_hour;
  useEffect(() => {
    if (typeof hour === 'number' && hour !== publishHour) setPublishHour(hour);
  }, [hour, publishHour]);

  const days = useMemo(
    () => (query.data ?? []).filter((d) => isUnlocked(d.date, now, publishHour)),
    // `now` is a fresh Date each render; the date string is what matters.
    [query.data, current, publishHour],
  );
  const today = days.find((d) => d.date === current) ?? null;
  return { ...query, days, today, currentDate: current, publishHour };
}

export function useJournal() {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: queryKeys.devotionals.journal(),
    queryFn: loadJournal,
    staleTime: Infinity,
    networkMode: 'always',
  });

  const update = useCallback(
    (dev: Devotional, patch: Partial<Omit<JournalEntry, 'date' | 'devotionalId'>>) => {
      const base = qc.getQueryData<Journal>(queryKeys.devotionals.journal()) ?? {};
      const nowIso = new Date().toISOString();
      const existing = base[dev.date] ?? emptyEntry(dev, nowIso);
      const entry: JournalEntry = {
        ...existing,
        ...patch,
        step: patch.step ? furthestStep(existing.step, patch.step) : existing.step,
        updatedAt: nowIso,
      };
      const next = { ...base, [dev.date]: entry };
      qc.setQueryData(queryKeys.devotionals.journal(), next);
      void saveJournal(next).catch(() => undefined);
    },
    [qc],
  );

  return { journal: query.data ?? null, loaded: query.isSuccess, update };
}
