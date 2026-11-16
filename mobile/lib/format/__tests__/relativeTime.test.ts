import { formatRelativeTime } from '../relativeTime';

const now = new Date('2026-10-02T12:00:00Z');
const ago = (seconds: number) => new Date(now.getTime() - seconds * 1000).toISOString();

describe('formatRelativeTime', () => {
  it('labels the recent past coarsely', () => {
    expect(formatRelativeTime(ago(5), now)).toBe('just now');
    expect(formatRelativeTime(ago(60), now)).toBe('1 minute ago');
    expect(formatRelativeTime(ago(5 * 60), now)).toBe('5 minutes ago');
    expect(formatRelativeTime(ago(3600), now)).toBe('1 hour ago');
    expect(formatRelativeTime(ago(2 * 86400), now)).toBe('2 days ago');
  });

  it('treats a timestamp slightly in the future as just now (clock skew)', () => {
    expect(formatRelativeTime(ago(-30), now)).toBe('just now');
  });

  it('falls back to a short date beyond a month', () => {
    expect(formatRelativeTime(ago(60 * 86400), now)).toMatch(/Aug \d+, 2026/);
  });
});
