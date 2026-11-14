import { routeForNotification } from '../notificationRoutes';

const ID = '3f2b8c1e-1a2b-4c3d-8e9f-0123456789ab';

describe('routeForNotification', () => {
  it('opens the sermon a new-sermon push names', () => {
    expect(routeForNotification({ kind: 'new_sermon', url: `/sermon/${ID}` })).toBe(`/sermon/${ID}`);
  });

  it("opens today's Daily Rhema in the phone's own date", () => {
    expect(routeForNotification({ kind: 'daily_rhema' }, new Date(2026, 10, 14, 7, 0))).toBe(
      '/devotional/2026-11-14',
    );
  });

  it('refuses anything outside the shared-link allow-list', () => {
    expect(routeForNotification({ url: '/delete-account' })).toBeNull();
    expect(routeForNotification({ url: 'https://evil.example/sermon/' + ID })).toBeNull();
    expect(routeForNotification(null)).toBeNull();
    expect(routeForNotification('x')).toBeNull();
  });
});
