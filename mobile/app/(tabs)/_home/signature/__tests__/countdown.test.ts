import { countdownParts, releaseLabel } from '../countdown';

describe('countdownParts', () => {
  const now = new Date('2026-10-21T12:00:00Z');

  it('splits the time left into days, hours and minutes, rounding up to the minute', () => {
    expect(countdownParts(new Date('2026-10-25T14:22:30Z'), now)).toEqual({ days: 4, hours: 2, minutes: 23 });
    expect(countdownParts(new Date('2026-10-21T12:00:05Z'), now)).toEqual({ days: 0, hours: 0, minutes: 1 });
  });

  it('is null once the release time has passed', () => {
    expect(countdownParts(now, now)).toBeNull();
    expect(countdownParts(new Date('2026-10-20T12:00:00Z'), now)).toBeNull();
  });
});

describe('releaseLabel', () => {
  it('names the weekday and a 12-hour time', () => {
    expect(releaseLabel(new Date(2026, 9, 25, 9, 0))).toBe('Sunday 9:00 AM');
    expect(releaseLabel(new Date(2026, 9, 25, 18, 5))).toBe('Sunday 6:05 PM');
    expect(releaseLabel(new Date(2026, 9, 25, 0, 30))).toBe('Sunday 12:30 AM');
  });
});
