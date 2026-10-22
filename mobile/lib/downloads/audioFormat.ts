/**
 * The file extension a decrypted audio download should carry, read from its first bytes.
 *
 * iOS's player (AVPlayer, under expo-video) picks a local file's decoder from its
 * extension and refuses one it doesn't recognise. The decrypted playback copy used to be
 * named `.pcm-tmp`, so every downloaded audio sermon failed to play on iPhone until the
 * download was removed and it streamed instead. The server accepts mp3, m4a/mp4, aac and
 * wav uploads and the download is those exact bytes, so the header says which it is.
 */
export type AudioExtension = 'mp3' | 'm4a' | 'aac' | 'wav';

/** How many leading bytes `audioExtensionFor` needs. */
export const AUDIO_HEADER_BYTES = 12;

function ascii(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.subarray(start, end));
}

export function audioExtensionFor(head: Uint8Array): AudioExtension {
  if (head.length >= 12 && ascii(head, 4, 8) === 'ftyp') return 'm4a';
  if (head.length >= 12 && ascii(head, 0, 4) === 'RIFF' && ascii(head, 8, 12) === 'WAVE') return 'wav';
  if (head.length >= 3 && ascii(head, 0, 3) === 'ID3') return 'mp3';
  // ADTS AAC: 12-bit sync word, then MPEG layer bits 00.
  if (head.length >= 2 && head[0] === 0xff && (head[1] & 0xf6) === 0xf0) return 'aac';
  // Anything else (a bare MPEG audio frame, or unrecognised) plays as mp3, the common case.
  return 'mp3';
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Decodes base64 (as `expo-file-system` reads a byte range) without relying on `atob`. */
export function base64ToBytes(base64: string): Uint8Array {
  const clean = base64.replace(/[^A-Za-z0-9+/]/g, '');
  const out: number[] = [];
  for (let i = 0; i + 1 < clean.length; i += 4) {
    const a = B64.indexOf(clean[i]);
    const b = B64.indexOf(clean[i + 1]);
    const c = i + 2 < clean.length ? B64.indexOf(clean[i + 2]) : -1;
    const d = i + 3 < clean.length ? B64.indexOf(clean[i + 3]) : -1;
    out.push((a << 2) | (b >> 4));
    if (c >= 0) out.push(((b & 15) << 4) | (c >> 2));
    if (d >= 0) out.push(((c & 3) << 6) | d);
  }
  return Uint8Array.from(out);
}
