import fs from 'fs';
import path from 'path';
import { SHARE_HOST, resolveIncomingLink } from '../allowList';

/**
 * Guards the native link configuration (ADR 0021) against drifting from the allow-list:
 * a changed host or path prefix in app.json silently stops App/Universal Links verifying.
 */
const appJson = JSON.parse(fs.readFileSync(path.join(__dirname, '../../../app.json'), 'utf8')).expo;
const CONTENT_TYPES = ['sermon', 'series', 'playlist'];
const UUID = '3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b';

describe('app.json link configuration', () => {
  it('declares the share host as the only iOS associated domain', () => {
    expect(appJson.ios.associatedDomains).toEqual([`applinks:${SHARE_HOST}`]);
  });

  it('has exactly one verified, browsable Android https intent filter for the content prefixes', () => {
    const filters = appJson.android.intentFilters as Array<{
      action: string;
      autoVerify?: boolean;
      category: string[];
      data: Array<{ scheme: string; host: string; pathPrefix: string }>;
    }>;
    expect(filters).toHaveLength(1);
    const [filter] = filters;
    expect(filter!.action).toBe('VIEW');
    expect(filter!.autoVerify).toBe(true);
    expect([...filter!.category].sort()).toEqual(['BROWSABLE', 'DEFAULT']);
    for (const d of filter!.data) {
      expect(d.scheme).toBe('https');
      expect(d.host).toBe(SHARE_HOST);
    }
    expect(filter!.data.map((d) => d.pathPrefix)).toEqual(CONTENT_TYPES.map((t) => `/${t}/`));
  });

  it('the allow-list resolves exactly the declared prefixes as content', () => {
    for (const t of CONTENT_TYPES) {
      expect(resolveIncomingLink(`https://${SHARE_HOST}/${t}/${UUID}`)).toEqual({
        kind: 'content',
        route: `/${t}/${UUID}`,
      });
    }
  });
});

describe('open_site apple-app-site-association', () => {
  const aasaPath = path.join(__dirname, '../../../../open_site/.well-known/apple-app-site-association');
  const reachable = fs.existsSync(aasaPath);
  (reachable ? it : it.skip)('claims the same content paths as the app config', () => {
    const aasa = JSON.parse(fs.readFileSync(aasaPath, 'utf8'));
    const components = aasa.applinks.details[0].components as Array<{ '/': string; exclude?: boolean }>;
    const included = components.filter((c) => !c.exclude).map((c) => c['/']);
    expect(included).toEqual(CONTENT_TYPES.map((t) => `/${t}/*`));
  });
});
