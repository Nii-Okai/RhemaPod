/**
 * Text helpers for the Daily Rhema flow: splitting a verse into tappable words, and a
 * deliberately small Markdown subset for the reflection (paragraphs, `> quotes`,
 * `*italic*`, `**bold**`), which is all the admin editor's hint promises.
 */

export interface Token {
  text: string;
  /** True for a word a listener can tap; false for spaces and punctuation. */
  word: boolean;
}

const WORD = /[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu;

export function tokenize(text: string): Token[] {
  const out: Token[] = [];
  let last = 0;
  for (const m of text.matchAll(WORD)) {
    const i = m.index ?? 0;
    if (i > last) out.push({ text: text.slice(last, i), word: false });
    out.push({ text: m[0], word: true });
    last = i + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), word: false });
  return out;
}

/** A word as kept: trailing possessive/punctuation trimmed, original case kept. */
export function cleanWord(word: string): string {
  return word.replace(/['’]s$/i, '').replace(/[-'’]+$/, '');
}

export function sameWord(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  return cleanWord(a).toLowerCase() === cleanWord(b).toLowerCase();
}

export interface Span {
  text: string;
  bold?: boolean;
  italic?: boolean;
}

export interface Block {
  kind: 'paragraph' | 'quote';
  spans: Span[];
}

function parseSpans(text: string): Span[] {
  const spans: Span[] = [];
  const re = /\*\*([^*]+)\*\*|\*([^*]+)\*|_([^_]+)_/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    const i = m.index ?? 0;
    if (i > last) spans.push({ text: text.slice(last, i) });
    if (m[1]) spans.push({ text: m[1], bold: true });
    else spans.push({ text: m[2] ?? m[3], italic: true });
    last = i + m[0].length;
  }
  if (last < text.length) spans.push({ text: text.slice(last) });
  return spans;
}

export function parseReflection(md: string): Block[] {
  return md
    .replace(/\r\n/g, '\n')
    .split(/\n\s*\n/)
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => {
      const lines = chunk.split('\n');
      const quote = lines.every((l) => l.trimStart().startsWith('>'));
      const body = (quote ? lines.map((l) => l.replace(/^\s*>\s?/, '')) : lines).join(' ').replace(/\s+/g, ' ');
      return { kind: quote ? 'quote' : 'paragraph', spans: parseSpans(body) } as Block;
    });
}

/** The plain text of a reflection, for reading aloud or screen readers. */
export function reflectionPlainText(md: string): string {
  return parseReflection(md)
    .map((b) => b.spans.map((s) => s.text).join(''))
    .join('\n\n');
}

/** The verse a word was tapped in, as "text" for the word garden. */
export function verseContaining(verses: { number: number | null; text: string }[], word: string): string | null {
  const v = verses.find((x) => tokenize(x.text).some((t) => t.word && sameWord(t.text, word)));
  return v ? v.text.trim() : null;
}

/** "m:ss" */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
