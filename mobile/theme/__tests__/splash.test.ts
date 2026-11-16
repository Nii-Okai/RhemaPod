import fs from 'fs';
import path from 'path';
import { darkColors, lightColors } from '../colors';

const MOBILE_ROOT = path.resolve(__dirname, '..', '..');
const appJson = require('../../app.json');

type SplashOptions = {
  image: string;
  backgroundColor: string;
  dark?: { image: string; backgroundColor: string };
};

function splashOptions(plugins: unknown[]): SplashOptions {
  const entry = plugins.find((p) => Array.isArray(p) && p[0] === 'expo-splash-screen') as
    | [string, SplashOptions]
    | undefined;
  if (!entry) throw new Error('expo-splash-screen plugin missing');
  return entry[1];
}

describe('native splash', () => {
  const declared = splashOptions(appJson.expo.plugins);

  // The native splash shows the mark alone on each palette's own ground, exactly where the
  // animated splash (`components/splash/AnimatedSplash.tsx`) starts, so the hand-off is
  // seamless.
  it('declares the bronze mark on the light ground and the gold mark on the navy ground', () => {
    expect(declared.backgroundColor).toBe(lightColors.surface.app);
    expect(declared.image).toBe('./assets/brand/mark-bronze.png');
    expect(declared.dark).toEqual({
      image: './assets/brand/mark-gold.png',
      backgroundColor: darkColors.surface.app,
    });
  });

  it('points at splash images that exist', () => {
    for (const image of [declared.image, declared.dark!.image]) {
      expect(fs.existsSync(path.join(MOBILE_ROOT, image))).toBe(true);
    }
  });
});
