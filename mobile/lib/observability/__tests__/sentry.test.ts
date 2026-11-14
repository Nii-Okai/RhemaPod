jest.mock('@sentry/react-native', () => ({
  reactNavigationIntegration: jest.fn(() => ({})),
  init: jest.fn(),
  setUser: jest.fn(),
  captureException: jest.fn(),
  wrap: (c: unknown) => c,
}));
jest.mock('expo-constants', () => ({ expoConfig: { version: '0.0.1' } }));

import { scrubBreadcrumb, scrubEvent } from '../sentry';

describe('scrubEvent', () => {
  it('keeps only the account id and drops request bodies, headers, cookies and query strings', () => {
    const out = scrubEvent({
      request: {
        url: 'https://customer.cloudflarestream.com/abc/manifest/video.m3u8?token=signed',
        query_string: 'token=signed',
        data: { password: 'x' },
        headers: { Authorization: 'Bearer t' },
        cookies: { a: 'b' },
      },
      user: { id: 'u1', email: 'a@b.c', ip_address: '1.2.3.4' },
    });
    expect(out.request).toEqual({ url: 'https://customer.cloudflarestream.com/abc/manifest/video.m3u8' });
    expect(out.user).toEqual({ id: 'u1' });
  });
});

describe('scrubBreadcrumb', () => {
  it('drops console breadcrumbs entirely', () => {
    expect(scrubBreadcrumb({ category: 'console', message: 'token=abc' })).toBeNull();
  });

  it('strips query strings from fetch and navigation breadcrumbs', () => {
    expect(scrubBreadcrumb({ category: 'fetch', data: { url: 'https://api.rhemapod.com/x?code=1', method: 'GET' } }))
      .toEqual({ category: 'fetch', data: { url: 'https://api.rhemapod.com/x', method: 'GET' } });
    expect(scrubBreadcrumb({ category: 'navigation', data: { from: '/a?x=1', to: '/b#y' } }))
      .toEqual({ category: 'navigation', data: { from: '/a', to: '/b' } });
  });
});
