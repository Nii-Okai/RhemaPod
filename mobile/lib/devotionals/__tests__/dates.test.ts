import {
  addDays,
  currentDevotionalDate,
  isUnlocked,
  prefetchWindow,
  weekOf,
} from '../dates';

/** A Date whose local fields read as given (tests run in the machine's zone; we only
    read local fields and toISOString, so build both explicitly). */
function at(localIso: string, utcIso: string): Date {
  const [d, t] = localIso.split('T');
  const [y, m, day] = d.split('-').map(Number);
  const [h, min] = t.split(':').map(Number);
  const fake = new Date(utcIso);
  fake.getFullYear = () => y;
  fake.getMonth = () => m - 1;
  fake.getDate = () => day;
  fake.getHours = () => h;
  fake.getMinutes = () => min;
  return fake;
}

describe('Daily Rhema dates', () => {
  it('switches to today at the publish hour, yesterday before it', () => {
    expect(currentDevotionalDate(at('2026-11-10T04:59', '2026-11-10T04:59:00Z'), 5)).toBe('2026-11-09');
    expect(currentDevotionalDate(at('2026-11-10T05:00', '2026-11-10T05:00:00Z'), 5)).toBe('2026-11-10');
  });

  it('never unlocks a prefetched future day', () => {
    const now = at('2026-11-10T09:00', '2026-11-10T09:00:00Z');
    expect(isUnlocked('2026-11-10', now, 5)).toBe(true);
    expect(isUnlocked('2026-11-11', now, 5)).toBe(false);
  });

  it('asks for the current day plus seven within the server window', () => {
    const now = at('2026-11-10T09:00', '2026-11-10T09:00:00Z');
    expect(prefetchWindow(now, 5)).toEqual({ from: '2026-11-10', count: 8 });
  });

  it('stays inside the window at UTC−12 before the publish hour', () => {
    // 02:00 on the 9th at UTC−12 is 14:00Z on the 9th. Today's devotional is still the
    // 8th, which is exactly UTC today − 1, the earliest the server accepts.
    const now = at('2026-11-09T02:00', '2026-11-09T14:00:00Z');
    expect(prefetchWindow(now, 5)).toEqual({ from: '2026-11-08', count: 8 });
  });

  it('clamps a start the server would refuse (clock or zone misconfigured)', () => {
    const skewed = at('2026-11-07T02:00', '2026-11-09T14:00:00Z');
    expect(prefetchWindow(skewed, 5).from).toBe('2026-11-08');
  });

  it('clamps the end at UTC+14 (local today is UTC tomorrow)', () => {
    const now = at('2026-11-11T09:00', '2026-11-10T19:00:00Z');
    const w = prefetchWindow(now, 5);
    expect(w.from).toBe('2026-11-11');
    expect(addDays(w.from, w.count - 1) <= '2026-11-18').toBe(true);
    expect(w.count).toBe(8);
  });

  it('builds a Monday-first week', () => {
    expect(weekOf('2026-11-15')).toEqual([
      '2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15',
    ]);
  });
});
