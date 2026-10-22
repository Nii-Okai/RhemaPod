import { darkColors, lightColors, type ColorTokens } from '../colors';

/**
 * WCAG 2.x contrast for the pairings the app actually renders, checked for BOTH palettes.
 * The light palette came from a design review that eyeballed nothing — every value was
 * run through this formula there too — and this pins it so a later tweak can't quietly
 * regress a pairing. Text/icon pairs need 4.5:1 (AA); the one non-text fill pair (gold
 * progress fill on its track) needs 3:1 (WCAG 1.4.11).
 */
function luminance(hex: string): number {
  const v = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16) / 255);
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

type Pair = [label: string, fg: (c: ColorTokens) => string, bg: (c: ColorTokens) => string, min: number];

const TEXT = 4.5;
const NON_TEXT = 3;

const PAIRS: Pair[] = [
  ['text.primary on app', (c) => c.text.primary, (c) => c.surface.app, TEXT],
  ['text.primary on raised', (c) => c.text.primary, (c) => c.surface.raised, TEXT],
  ['text.secondary on app', (c) => c.text.secondary, (c) => c.surface.app, TEXT],
  ['text.secondary on raised', (c) => c.text.secondary, (c) => c.surface.raised, TEXT],
  ['text.tertiary on app', (c) => c.text.tertiary, (c) => c.surface.app, TEXT],
  ['text.tertiary on raised', (c) => c.text.tertiary, (c) => c.surface.raised, TEXT],
  ['text.tertiary on sunken', (c) => c.text.tertiary, (c) => c.surface.sunken, TEXT],
  ['goldText on app', (c) => c.accent.goldText, (c) => c.surface.app, TEXT],
  ['goldText on raised', (c) => c.accent.goldText, (c) => c.surface.raised, TEXT],
  ['goldHover on app', (c) => c.accent.goldHover, (c) => c.surface.app, TEXT],
  ['primaryButton text on bg', (c) => c.primaryButton.text, (c) => c.primaryButton.bg, TEXT],
  ['status.sage text on bg', (c) => c.status.sage.text, (c) => c.status.sage.bg, TEXT],
  ['status.rose text on bg', (c) => c.status.rose.text, (c) => c.status.rose.bg, TEXT],
  ['status.slate text on bg', (c) => c.status.slate.text, (c) => c.status.slate.bg, TEXT],
  // Signature Browse's wheat category tile sets its name in the dot colour.
  ['status.wheat dot on bg', (c) => c.status.wheat.dot, (c) => c.status.wheat.bg, TEXT],
  ['gold fill on track', (c) => c.accent.gold, (c) => c.track.default, NON_TEXT],
];

describe.each([
  ['dark', darkColors as ColorTokens],
  ['light', lightColors],
])('%s palette contrast', (_name, palette) => {
  it.each(PAIRS)('%s', (_label, fg, bg, min) => {
    expect(contrast(fg(palette), bg(palette))).toBeGreaterThanOrEqual(min);
  });
});

describe('light palette — design-review specifics', () => {
  it('goldText on the gold-tinted chips stays legible (review: 4.4–4.8:1)', () => {
    // Icon glyphs on chips are large/graphic — WCAG 1.4.11's 3:1 applies — but the review
    // aimed higher; pin what it measured so a chip tweak can't sink below it.
    expect(contrast(lightColors.accent.goldText, lightColors.chip.circle)).toBeGreaterThanOrEqual(4.4);
    expect(contrast(lightColors.accent.goldText, lightColors.chip.square)).toBeGreaterThanOrEqual(4.4);
  });

  it('keeps the art overlay identical to dark mode (it sits on art, not on chrome)', () => {
    expect(lightColors.overlay).toEqual(darkColors.overlay);
  });

  it('has exactly the dark palette\'s shape', () => {
    const keys = (o: object): string[] =>
      Object.entries(o).flatMap(([k, v]) =>
        v && typeof v === 'object' && !Array.isArray(v) ? keys(v).map((s) => `${k}.${s}`) : [k],
      );
    expect(keys(lightColors).sort()).toEqual(keys(darkColors).sort());
    expect(lightColors.fade.layers).toHaveLength(darkColors.fade.layers.length);
  });
});
