import { cacheKeyFor } from '../key';
import { expectNoSecrets, SECRET_URL } from './helpers';

const ID_A = '3f2b8c1e-9d4a-4e6b-8a1c-0123456789ab';
const ID_B = '7a1d2e3f-0b9c-4d8e-9f10-abcdef012345';
const audioRef = { id: ID_A, type: 'audio' };
const videoRef = { id: ID_B, type: 'video' };
const audioVariant = (url: string) => ({ type: 'audio', url });

describe('cacheKeyFor', () => {
  it('maps an audio ref + mp3 URL to {mediaRefId, fileName} with allow-listed ext', () => {
    expect(cacheKeyFor([audioRef], audioVariant('https://cdn.example.com/a.mp3?sig=1'))).toEqual({
      mediaRefId: ID_A,
      fileName: `${ID_A}.mp3`,
    });
  });

  it('normalizes an uppercase UUID to lowercase', () => {
    const key = cacheKeyFor([{ id: ID_A.toUpperCase(), type: 'audio' }], audioVariant('https://x.io/a.mp3'));
    expect(key).toEqual({ mediaRefId: ID_A, fileName: `${ID_A}.mp3` });
  });

  it.each(['https://x.io/a.m3u8', 'https://x.io/a.m3u8?token=abc', 'https://x.io/a.M3U8', 'https://x.io/a.m3u8#frag'])(
    'returns null for HLS URL %s',
    (url) => {
      expect(cacheKeyFor([audioRef], audioVariant(url))).toBeNull();
    },
  );

  it('does not treat a .m3u8 in the query as HLS', () => {
    expect(cacheKeyFor([audioRef], audioVariant('https://x.io/a.mp3?f=a.m3u8'))).not.toBeNull();
  });

  it.each(['file:///a.mp3', 'data:audio/mp3;base64,AAAA', 'blob:https://x.io/1', '', 'not a url', 'http://', 'https:///a.mp3'])(
    'returns null for non-http(s)/malformed URL %j',
    (url) => {
      expect(cacheKeyFor([audioRef], audioVariant(url))).toBeNull();
    },
  );

  it('accepts http and https', () => {
    expect(cacheKeyFor([audioRef], audioVariant('http://x.io/a.mp3'))).not.toBeNull();
    expect(cacheKeyFor([audioRef], audioVariant('HTTPS://x.io/a.mp3'))).not.toBeNull();
  });

  it.each(['', '123', `${ID_A}x`, `${ID_A}-extra`, ` ${ID_A}`, '../x', `../${ID_A}`, `${ID_A}/../x`])(
    'returns null for non-UUID id %j',
    (id) => {
      expect(cacheKeyFor([{ id, type: 'audio' }], audioVariant('https://x.io/a.mp3'))).toBeNull();
    },
  );

  it('returns null when no ref matches the variant type', () => {
    expect(cacheKeyFor([videoRef], audioVariant('https://x.io/a.mp3'))).toBeNull();
    expect(cacheKeyFor([], audioVariant('https://x.io/a.mp3'))).toBeNull();
  });

  it('picks the ref matching the variant type among several', () => {
    expect(cacheKeyFor([audioRef, videoRef], { type: 'video', url: 'https://x.io/v.mp4' })).toEqual({
      mediaRefId: ID_B,
      fileName: `${ID_B}.mp4`,
    });
  });

  it('returns null for an unknown media type (no allow-listed ext)', () => {
    expect(cacheKeyFor([{ id: ID_A, type: 'document' }], { type: 'document', url: 'https://x.io/d.pdf' })).toBeNull();
    expect(cacheKeyFor([{ id: ID_A, type: 'constructor' }], { type: 'constructor', url: 'https://x.io/d' })).toBeNull();
  });

  it('never puts ?, /, %, .. or any URL substring in the file name', () => {
    const hostile = [
      SECRET_URL,
      'https://x.io/a%2F..%2Fb.mp3?sig=%3D%3D',
      'https://x.io/../../etc/passwd.mp3?a=b/c',
      'https://user:pw@host.io/path/file.mp3?token=abc.def',
    ];
    const names: string[] = [];
    for (const url of hostile) {
      const key = cacheKeyFor([audioRef], audioVariant(url));
      expect(key).not.toBeNull();
      const { fileName } = key!;
      names.push(fileName);
      for (const bad of ['?', '/', '%', '..']) expect(fileName).not.toContain(bad);
      const pieces = url.split(/[/?&=:@]+/).filter((p) => p.length >= 4 && !/^(https?|mp3)$/i.test(p));
      for (const piece of pieces) expect(fileName).not.toContain(piece);
    }
    expectNoSecrets([], names);
  });
});
