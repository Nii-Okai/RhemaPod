import { PixelRatio } from 'react-native';
import { scaledLineHeight } from '../typography';

describe('scaledLineHeight', () => {
  it('multiplies fontSize by the ratio at the default (1x) device font scale', () => {
    jest.spyOn(PixelRatio, 'getFontScale').mockReturnValue(1);

    expect(scaledLineHeight(20, 1.1)).toBe(22);
  });

  it('grows proportionally when the OS font scale is larger (accessibility setting on)', () => {
    jest.spyOn(PixelRatio, 'getFontScale').mockReturnValue(1.5);

    // 20 * 1.1 * 1.5 = 33 — must scale in lockstep with fontSize, not stay fixed.
    expect(scaledLineHeight(20, 1.1)).toBe(33);
  });
});
