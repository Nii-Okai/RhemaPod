import { formatPlaylistMinutes } from '../playlistDuration';

describe('formatPlaylistMinutes', () => {
  it('rounds seconds to the nearest minute', () => {
    expect(formatPlaylistMinutes(720)).toBe('12 min');
    expect(formatPlaylistMinutes(750)).toBe('13 min'); // 12.5 -> rounds up
    expect(formatPlaylistMinutes(29)).toBe('0 min');
  });

  it('falls back to "0 min" for a missing/invalid value — an empty playlist', () => {
    expect(formatPlaylistMinutes(null)).toBe('0 min');
    expect(formatPlaylistMinutes(undefined)).toBe('0 min');
    expect(formatPlaylistMinutes(-5)).toBe('0 min');
    expect(formatPlaylistMinutes(NaN)).toBe('0 min');
  });

  it('renders 0 seconds as "0 min", not "--:--"', () => {
    expect(formatPlaylistMinutes(0)).toBe('0 min');
  });
});
