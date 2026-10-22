import fs from 'fs';
import path from 'path';
import { lightColors } from '../colors';

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

  it('declares a light splash on the light palette and the navy splash for dark', () => {
    expect(declared.backgroundColor).toBe(lightColors.surface.app);
    expect(declared.image).toBe('./assets/splash-icon-light.png');
    expect(declared.dark).toEqual({ image: './assets/splash-icon.png', backgroundColor: '#0B1725' });
  });

  it('points at splash images that exist', () => {
    for (const image of [declared.image, declared.dark!.image]) {
      expect(fs.existsSync(path.join(MOBILE_ROOT, image))).toBe(true);
    }
  });
});
