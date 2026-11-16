import { formatWhen, isFresh, splitNotifications } from '../notificationTime';

// Wednesday 21 October 2026, 15:00 local.
const now = new Date(2026, 9, 21, 15, 0);
const at = (y: number, m: number, d: number, h = 0, min = 0, sec = 0) => new Date(y, m, d, h, min, sec).toISOString();

describe('formatWhen', () => {
  it('counts minutes and hours on the release day', () => {
    expect(formatWhen(at(2026, 9, 21, 14, 59, 30), now)).toBe('JUST NOW');
    expect(formatWhen(at(2026, 9, 21, 14, 48), now)).toBe('12M AGO');
    expect(formatWhen(at(2026, 9, 21, 10, 0), now)).toBe('5H AGO');
  });

  it('turns to yesterday at midnight, then weekdays, then dates', () => {
    expect(formatWhen(at(2026, 9, 20, 23, 0), now)).toBe('YESTERDAY');
    expect(formatWhen(at(2026, 9, 19, 9, 0), now)).toBe('MON');
    expect(formatWhen(at(2026, 9, 13, 9, 0), now)).toBe('13 OCT');
    expect(formatWhen(at(2025, 11, 28, 9, 0), now)).toBe('28 DEC 2025');
  });

  it('returns null without a publish time', () => {
    expect(formatWhen(null, now)).toBeNull();
    expect(formatWhen('not a date', now)).toBeNull();
  });
});

describe('splitNotifications', () => {
  it('features the newest and splits the rest at one week, keeping order', () => {
    const items = [
      { id: 'a', publish_at: at(2026, 9, 21, 13) },
      { id: 'b', publish_at: at(2026, 9, 20, 9) },
      { id: 'c', publish_at: at(2026, 9, 10, 9) },
      { id: 'd', publish_at: null },
      { id: 'e', publish_at: at(2026, 9, 16, 9) },
    ];
    const { latest, fresh, earlier } = splitNotifications(items, now);
    expect(latest?.id).toBe('a');
    expect(fresh.map((i) => i.id)).toEqual(['b', 'e']);
    expect(earlier.map((i) => i.id)).toEqual(['c', 'd']);
  });

  it('handles an empty list', () => {
    expect(splitNotifications([], now)).toEqual({ latest: null, fresh: [], earlier: [] });
  });

  it('treats a future or missing publish time as not fresh', () => {
    expect(isFresh(at(2026, 9, 22, 9), now)).toBe(false);
    expect(isFresh(undefined, now)).toBe(false);
  });
});
