import React from 'react';
import { render } from '@testing-library/react-native';
import { BACKDROP_SCRIM, PlayerBackdrop } from '../PlayerBackdrop';
import { darkColors, lightColors } from '../../../../theme/colors';

const channels = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const linear = (c: number) => {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
};
const luminance = ([r, g, b]: number[]) => 0.2126 * linear(r!) + 0.7152 * linear(g!) + 0.0722 * linear(b!);
const contrast = (a: number[], b: number[]) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};
/** The page colour at `opacity` over art of `art`. */
const over = (page: string, art: number[], opacity: number) => channels(page).map((v, i) => v * opacity + art[i]! * (1 - opacity));

describe('PlayerBackdrop', () => {
  const thinnest = Math.min(...BACKDROP_SCRIM.map((stop) => stop.opacity));

  it.each([
    // The worst art for each theme: white under the dark wash, black under the light one.
    ['dark', darkColors, [255, 255, 255]],
    ['light', lightColors, [0, 0, 0]],
  ] as const)('keeps text readable in the %s theme over the harshest art', (_scheme, palette, art) => {
    const ground = over(palette.surface.app, [...art], thinnest);
    expect(contrast(channels(palette.text.primary), ground)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(channels(palette.text.secondary), ground)).toBeGreaterThanOrEqual(3);
  });

  it('thickens toward the bottom', () => {
    const opacities = BACKDROP_SCRIM.map((stop) => stop.opacity);
    expect([...opacities].sort()).toEqual(opacities);
  });

  it('draws the blurred art when there is some', () => {
    const screen = render(<PlayerBackdrop uri="https://cdn.example.com/art.jpg?sig=1" />);
    const art = screen.getByTestId('player-backdrop-art');
    expect(art.props.blurRadius).toBeGreaterThan(0);
  });

  it('is just the page without art', () => {
    const screen = render(<PlayerBackdrop uri={null} />);
    expect(screen.queryByTestId('player-backdrop-art')).toBeNull();
  });
});
