import { audioExtensionFor, base64ToBytes } from '../audioFormat';

const bytes = (...values: (number | string)[]) =>
  Uint8Array.from(values.flatMap((v) => (typeof v === 'string' ? [...v].map((c) => c.charCodeAt(0)) : [v])));

describe('audioExtensionFor', () => {
  it('reads m4a/mp4 from the ftyp box', () => {
    expect(audioExtensionFor(bytes(0, 0, 0, 0x20, 'ftypM4A '))).toBe('m4a');
  });
  it('reads wav from the RIFF/WAVE header', () => {
    expect(audioExtensionFor(bytes('RIFF', 0, 0, 0, 0, 'WAVE'))).toBe('wav');
  });
  it('reads mp3 from an ID3 tag', () => {
    expect(audioExtensionFor(bytes('ID3', 4, 0, 0, 0, 0, 0, 0, 0, 0))).toBe('mp3');
  });
  it('tells ADTS AAC apart from a bare MPEG audio frame', () => {
    expect(audioExtensionFor(bytes(0xff, 0xf1, 0x50, 0x80, 0, 0, 0, 0, 0, 0, 0, 0))).toBe('aac');
    expect(audioExtensionFor(bytes(0xff, 0xfb, 0x90, 0x64, 0, 0, 0, 0, 0, 0, 0, 0))).toBe('mp3');
  });
  it('falls back to mp3 for anything unrecognised', () => {
    expect(audioExtensionFor(bytes(1, 2, 3))).toBe('mp3');
  });
});

describe('base64ToBytes', () => {
  it('decodes padded and unpadded input', () => {
    expect([...base64ToBytes('SUQzBA==')]).toEqual([0x49, 0x44, 0x33, 0x04]);
    expect([...base64ToBytes('AAAAIGZ0eXBNNEEg')]).toEqual([0, 0, 0, 0x20, ...'ftypM4A '].map((v) => (typeof v === 'string' ? v.charCodeAt(0) : v)));
  });
});
