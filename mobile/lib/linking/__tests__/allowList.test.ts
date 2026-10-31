import { GOOGLE_CALLBACK_SCHEME, resolveIncomingLink } from '../allowList';

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
    it('passes the app\'s own Google callback (scheme + /oauthredirect) through untouched', () => {
      const url = `${GOOGLE_CALLBACK_SCHEME}:/oauthredirect`;
      expect(resolveIncomingLink(url)).toEqual({ kind: 'passthrough', path: url });
      const withQuery = `${url}?code=abc&state=xyz`;
      expect(resolveIncomingLink(withQuery)).toEqual({ kind: 'passthrough', path: withQuery });
    });

    it.each([
      ['real scheme, other path', `${GOOGLE_CALLBACK_SCHEME}:/settings`],
      ['real scheme, no path', `${GOOGLE_CALLBACK_SCHEME}:`],
      ['real scheme, path prefix trick', `${GOOGLE_CALLBACK_SCHEME}:/oauthredirect/../settings`],
      ['foreign client id', 'com.googleusercontent.apps.attacker:/oauthredirect'],
      ['foreign client id, other path', 'com.googleusercontent.apps.827558560538-abc:/oauthredirect'],
      ['real scheme as prefix of a longer scheme', `${GOOGLE_CALLBACK_SCHEME}x:/oauthredirect`],
    ])('%s -> home', (_label, url) => {
      expect(resolveIncomingLink(url)).toEqual({ kind: 'home' });
    });

    describe('dev-client launcher links', () => {
      const links = [
        'rhemapod://expo-development-client/?url=http%3A%2F%2F192.168.1.2%3A8081',
        'rhemapod://expo-development-client',
        'exp+rhemapod-mobile://expo-development-client/?url=http%3A%2F%2Fx',
      ];
      const g = globalThis as { __DEV__?: boolean };
      const original = g.__DEV__;
      afterEach(() => {
        g.__DEV__ = original;
      });

      it.each(links)('in __DEV__, %s passes through untouched', (url) => {
        g.__DEV__ = true;
        expect(resolveIncomingLink(url)).toEqual({ kind: 'passthrough', path: url });
      });

      it.each(links)('in release, %s -> home', (url) => {
        g.__DEV__ = false;
        expect(resolveIncomingLink(url)).toEqual({ kind: 'home' });
      });
    });
  });
});
