import { resolveIncomingLink } from '../allowList';

const ID = '3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b';

describe('resolveIncomingLink', () => {
  describe.each(['sermon', 'series', 'playlist'])('%s', (type) => {
    const route = { kind: 'content', route: `/${type}/${ID}` };
    it.each([
      ['https', `https://open.rhemapod.com/${type}/${ID}`],
      ['scheme', `rhemapod://${type}/${ID}`],
      ['scheme triple slash', `rhemapod:///${type}/${ID}`],
      ['bare path', `/${type}/${ID}`],
      ['trailing slash', `https://open.rhemapod.com/${type}/${ID}/`],
      ['query string', `https://open.rhemapod.com/${type}/${ID}?ref=share&x=<script>`],
      ['fragment', `rhemapod://${type}/${ID}#frag`],
      ['uppercase uuid', `https://open.rhemapod.com/${type}/${ID.toUpperCase()}`],
      ['uppercase host and scheme', `HTTPS://Open.RhemaPod.com/${type}/${ID}`],
    ])('%s -> same route', (_label, url) => {
      expect(resolveIncomingLink(url)).toEqual(route);
    });
  });

  it.each([
    ['/playlist/create', 'rhemapod://playlist/create'],
    ['/playlist/create (https)', 'https://open.rhemapod.com/playlist/create'],
    ['unknown path', 'https://open.rhemapod.com/admin/settings'],
    ['unknown scheme path', 'rhemapod://(tabs)/home'],
    ['non-uuid id', `https://open.rhemapod.com/sermon/sermon-1`],
    ['nested path', `https://open.rhemapod.com/sermon/${ID}/extra`],
    ['path traversal', `rhemapod://sermon/${ID}/../../notifications`],
    ['foreign host', `https://evil.com/sermon/${ID}`],
    ['lookalike host', `https://open.rhemapod.com.evil.com/sermon/${ID}`],
    ['userinfo host', `https://open.rhemapod.com@evil.com/sermon/${ID}`],
    ['explicit port', `https://open.rhemapod.com:8443/sermon/${ID}`],
    ['http (not https)', `http://open.rhemapod.com/sermon/${ID}`],
    ['apex host', `https://rhemapod.com/sermon/${ID}`],
    ['other scheme', `evil://sermon/${ID}`],
    ['root', 'rhemapod://'],
    ['empty', ''],
  ])('%s -> home', (_label, url) => {
    expect(resolveIncomingLink(url)).toEqual({ kind: 'home' });
  });

  // Inbound uses that exist for non-content reasons (inventory in status.md, S5).
  describe('preserved non-content inbound uses', () => {
    it.each([
      ['Google iOS sign-in callback', 'com.googleusercontent.apps.827558560538-ujevidt1217i6a2gu8fm9sn8je755kta:/oauthredirect'],
      ['dev-client launcher', 'rhemapod://expo-development-client/?url=http%3A%2F%2F192.168.1.2%3A8081'],
      ['dev-client launcher (bare)', 'rhemapod://expo-development-client'],
      ['dev-client exp+ scheme', 'exp+rhemapod-mobile://expo-development-client/?url=http%3A%2F%2Fx'],
    ])('%s passes through untouched', (_label, url) => {
      expect(resolveIncomingLink(url)).toEqual({ kind: 'passthrough', path: url });
    });
  });
});
