import fs from 'fs';
import path from 'path';
import { lightColors } from '../colors';

const MOBILE_ROOT = path.resolve(__dirname, '..', '..');
const appConfig = require('../../app.config.js');
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

// Calls the rollout transform directly rather than through `process.env`: Jest runs files
// through babel-preset-expo, which inlines `EXPO_PUBLIC_*` at transform time.
function resolvedSplash(lightModeEnabled: boolean): SplashOptions {
  return splashOptions(appConfig.splashForRollout(appJson.expo.plugins, lightModeEnabled));
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

  it('passes app.json through untouched apart from the splash', () => {
    const resolved = appConfig({ config: appJson.expo });
    expect(resolved.plugins).toHaveLength(appJson.expo.plugins.length);
    expect(resolved.name).toBe(appJson.expo.name);
  });

  it('follows the phone appearance once light mode is enabled', () => {
    expect(resolvedSplash(true)).toEqual(declared);
  });

  it('stays dark-only while light mode is behind its rollout flag', () => {
    const splash = resolvedSplash(false);
    expect(splash.dark).toBeUndefined();
    expect(splash.image).toBe('./assets/splash-icon.png');
    expect(splash.backgroundColor).toBe('#0B1725');
    expect(splash).toMatchObject({ imageWidth: 280, resizeMode: 'contain' });
  });
});
