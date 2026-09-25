import { formatAnnouncementDateRange } from '../announcementDateRange';

describe('formatAnnouncementDateRange', () => {
  it('formats a bounded window as "Mon D → Mon D" (design spec 1k)', () => {
    expect(formatAnnouncementDateRange('2026-09-08T00:00:00Z', '2026-10-04T00:00:00Z')).toBe('Sep 8 → Oct 4');
  });

  it('renders "→ —" for an ongoing announcement (no expiry)', () => {
    expect(formatAnnouncementDateRange('2026-09-10T00:00:00Z', null)).toBe('Sep 10 → —');
    expect(formatAnnouncementDateRange('2026-09-10T00:00:00Z', undefined)).toBe('Sep 10 → —');
  });

  it('renders "— → —" when even the start is unknown', () => {
    expect(formatAnnouncementDateRange(null, null)).toBe('— → —');
  });

  it('falls back to "—" for an unparsable date rather than throwing', () => {
    expect(formatAnnouncementDateRange('not-a-date', '2026-10-04T00:00:00Z')).toBe('— → Oct 4');
  });
});
