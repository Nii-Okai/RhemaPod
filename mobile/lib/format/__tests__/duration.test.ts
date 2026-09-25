import { formatDuration } from '../duration';

describe('formatDuration', () => {
  it('formats sub-hour durations as m:ss', () => {
    expect(formatDuration(65)).toBe('1:05');
    expect(formatDuration(3599)).toBe('59:59');
  });

  it('formats hour-plus durations as h:mm:ss', () => {
    expect(formatDuration(3600)).toBe('1:00:00');
    expect(formatDuration(3725)).toBe('1:02:05');
  });

  it('falls back to a placeholder for a missing/invalid value — the "still probing" case', () => {
    expect(formatDuration(null)).toBe('--:--');
    expect(formatDuration(undefined)).toBe('--:--');
    expect(formatDuration(-5)).toBe('--:--');
    expect(formatDuration(NaN)).toBe('--:--');
  });
});
