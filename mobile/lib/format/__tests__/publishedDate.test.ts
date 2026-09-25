import { formatPublishedDate } from '../publishedDate';

describe('formatPublishedDate', () => {
  it('formats an ISO datetime as a short month/day', () => {
    expect(formatPublishedDate('2026-09-04T12:00:00Z')).toBe('Sep 4');
  });
});
