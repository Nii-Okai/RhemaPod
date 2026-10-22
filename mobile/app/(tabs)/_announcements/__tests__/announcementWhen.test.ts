import { formatAnnouncementWhen } from '../announcementWhen';

// Noon local time, so the day never shifts with the machine's timezone.
const at = (y: number, m: number, d: number) => new Date(y, m - 1, d, 12).toISOString();
const now = new Date(2026, 9, 22, 12);
const when = (publish_at: string | null, expires_at: string | null, created_at = at(2026, 10, 1)) =>
  formatAnnouncementWhen({ publish_at, expires_at, created_at }, now);

describe('formatAnnouncementWhen', () => {
  it('spans two months', () => {
    expect(when(at(2026, 10, 25), at(2026, 11, 3))).toBe('25 OCT – 3 NOV');
  });

  it('shares the month inside one month', () => {
    expect(when(at(2026, 10, 25), at(2026, 10, 31))).toBe('25 – 31 OCT');
  });

  it('shows one day once', () => {
    expect(when(at(2026, 10, 25), at(2026, 10, 25))).toBe('25 OCT');
  });

  it('adds the year outside the current one', () => {
    expect(when(at(2026, 12, 28), at(2027, 1, 4))).toBe('28 DEC – 4 JAN 2027');
  });

  it('handles an open end or an open start', () => {
    expect(when(at(2026, 10, 25), null)).toBe('FROM 25 OCT');
    expect(when(null, at(2026, 11, 3))).toBe('UNTIL 3 NOV');
  });

  it('falls back to when it was posted, then to nothing', () => {
    expect(when(null, null)).toBe('POSTED 1 OCT');
    expect(when(null, 'not a date', '')).toBeNull();
  });
});
