const fs = require('node:fs');
const path = require('node:path');
const {
  CHANNEL_PROFILES,
  resolveProfile,
  easEnvironment,
  nativeChanges,
  parseArgs,
  easUpdateArgs,
} = require('../publish-update');

const easJson = JSON.parse(fs.readFileSync(path.join(__dirname, '../../eas.json'), 'utf8'));

describe('channels in eas.json', () => {
  it.each(Object.entries(CHANNEL_PROFILES))('channel %s is the one profile %s builds on', (channel, profile) => {
    expect(resolveProfile(easJson, profile).channel).toBe(channel);
  });

  it('gives staging and production the production API, so an update never points at localhost', () => {
    for (const channel of ['staging', 'production']) {
      const env = resolveProfile(easJson, CHANNEL_PROFILES[channel]).env;
      expect(env.EXPO_PUBLIC_API_BASE_URL).toBe('https://api.rhemapod.com');
    }
  });

  it('uses the EAS environment each profile builds with', () => {
    expect(easEnvironment(resolveProfile(easJson, 'development'))).toBe('development');
    expect(easEnvironment(resolveProfile(easJson, 'android-internal'))).toBe('preview');
    expect(easEnvironment(resolveProfile(easJson, 'testflight'))).toBe('production');
    expect(easEnvironment({ environment: 'staging', distribution: 'internal' })).toBe('staging');
  });
});

describe('resolveProfile', () => {
  it('merges extends, env and platform blocks', () => {
    const json = {
      build: {
        base: { channel: 'a', env: { A: '1', B: '1' }, ios: { image: 'x' } },
        child: { extends: 'base', env: { B: '2' }, android: { buildType: 'apk' } },
      },
    };
    expect(resolveProfile(json, 'child')).toEqual({
      channel: 'a',
      env: { A: '1', B: '2' },
      ios: { image: 'x' },
      android: { buildType: 'apk' },
    });
  });

  it('rejects unknown and circular profiles', () => {
    expect(() => resolveProfile({ build: {} }, 'nope')).toThrow('no build profile');
    expect(() => resolveProfile({ build: { a: { extends: 'b' }, b: { extends: 'a' } } }, 'a')).toThrow('extends itself');
  });
});

describe('nativeChanges', () => {
  const pkg = { dependencies: { expo: '1' }, devDependencies: { jest: '1' }, scripts: { a: 'x' } };

  it('ignores JavaScript-only changes', () => {
    expect(nativeChanges(['app/index.tsx', 'lib/api/config.ts', 'assets/logo.png'], pkg, pkg)).toEqual([]);
  });

  it('flags config, plugins, local modules and patches', () => {
    const files = ['app.json', 'app.config.js', 'plugins/withX.js', 'modules/rpa-crypto/ios/X.swift', 'patches/expo-video+2.0.6.patch'];
    expect(nativeChanges(files, pkg, pkg)).toEqual(files);
  });

  it('flags package.json only when dependencies changed', () => {
    const scriptsOnly = { ...pkg, scripts: { a: 'y' }, devDependencies: { jest: '2' } };
    expect(nativeChanges(['package.json'], pkg, scriptsOnly)).toEqual([]);
    const newDep = { ...pkg, dependencies: { expo: '1', 'expo-camera': '1' } };
    expect(nativeChanges(['package.json'], pkg, newDep)).toEqual(['package.json']);
  });
});

describe('parseArgs and easUpdateArgs', () => {
  it('builds the eas update command', () => {
    const args = parseArgs(['--channel', 'production', '--message', 'Fix timer', '--rollout', '10']);
    expect(easUpdateArgs({ ...args, environment: 'production' })).toEqual([
      'update', '--channel', 'production', '--environment', 'production', '--message', 'Fix timer',
      '--non-interactive', '--rollout-percentage', '10',
    ]);
  });

  it('leaves out a 100% rollout', () => {
    const args = parseArgs(['--channel', 'staging', '--rollout', '100']);
    expect(easUpdateArgs({ ...args, message: 'm', environment: 'preview' })).not.toContain('--rollout-percentage');
  });

  it('rejects bad input', () => {
    expect(() => parseArgs([])).toThrow('--channel must be one of');
    expect(() => parseArgs(['--channel', 'prod'])).toThrow('--channel must be one of');
    expect(() => parseArgs(['--channel', 'staging', '--rollout', '0'])).toThrow('--rollout');
    expect(() => parseArgs(['--channel', 'staging', '--message'])).toThrow('needs a value');
    expect(() => parseArgs(['--channel', 'staging', '--yes'])).toThrow('Unknown option');
  });
});
