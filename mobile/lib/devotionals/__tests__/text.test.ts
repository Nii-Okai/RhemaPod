import { cleanWord, parseReflection, reflectionPlainText, sameWord, tokenize, verseContaining } from '../text';

describe('tokenize', () => {
  it('keeps every character and marks words', () => {
    const t = tokenize('Be still, and know.');
    expect(t.map((x) => x.text).join('')).toBe('Be still, and know.');
    expect(t.filter((x) => x.word).map((x) => x.text)).toEqual(['Be', 'still', 'and', 'know']);
  });

  it('keeps apostrophes inside a word', () => {
    expect(tokenize("God's refuge").filter((x) => x.word).map((x) => x.text)).toEqual(["God's", 'refuge']);
  });
});

describe('words', () => {
  it('trims possessives and compares case-insensitively', () => {
    expect(cleanWord("God's")).toBe('God');
    expect(sameWord('STILL', 'still')).toBe(true);
    expect(sameWord(null, 'still')).toBe(false);
  });

  it('finds the verse a word came from', () => {
    const verses = [
      { number: 1, text: 'God is our refuge.' },
      { number: 10, text: 'Be still, and know.' },
    ];
    expect(verseContaining(verses, 'still')).toBe('Be still, and know.');
    expect(verseContaining(verses, 'storm')).toBeNull();
  });
});

describe('parseReflection', () => {
  it('splits paragraphs and quotes, with bold and italic spans', () => {
    const blocks = parseReflection('Notice **where** this sits.\n\n> Be *still*\n> and know\n\nLast line.');
    expect(blocks.map((b) => b.kind)).toEqual(['paragraph', 'quote', 'paragraph']);
    expect(blocks[0].spans).toEqual([{ text: 'Notice ' }, { text: 'where', bold: true }, { text: ' this sits.' }]);
    expect(blocks[1].spans).toEqual([{ text: 'Be ' }, { text: 'still', italic: true }, { text: ' and know' }]);
  });

  it('flattens to plain text', () => {
    expect(reflectionPlainText('A **b**\n\nc')).toBe('A b\n\nc');
  });
});
