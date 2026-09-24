import { TABLET_BREAKPOINT, deviceClassForWidth, resolveChromeVariant } from '../useDeviceClass';

describe('deviceClassForWidth — the 768pt breakpoint (plan L15/§A.7)', () => {
  it('is phone just under the breakpoint', () => {
    expect(deviceClassForWidth(TABLET_BREAKPOINT - 1)).toBe('phone');
  });

  it('is tablet at and above the breakpoint', () => {
    expect(deviceClassForWidth(TABLET_BREAKPOINT)).toBe('tablet');
    expect(deviceClassForWidth(1024)).toBe('tablet');
  });
});

describe('resolveChromeVariant', () => {
  it('picks the rail for tablet width regardless of platform', () => {
    expect(resolveChromeVariant('tablet', 'ios')).toBe('tablet-rail');
    expect(resolveChromeVariant('tablet', 'android')).toBe('tablet-rail');
  });

  it('picks the text-only iOS bar or the Material 3 Android bar below the breakpoint', () => {
    expect(resolveChromeVariant('phone', 'ios')).toBe('ios-tabs');
    expect(resolveChromeVariant('phone', 'android')).toBe('android-tabs');
  });

  it('falls back to the Android chrome for any other platform rather than throwing', () => {
    expect(resolveChromeVariant('phone', 'web')).toBe('android-tabs');
  });
});
