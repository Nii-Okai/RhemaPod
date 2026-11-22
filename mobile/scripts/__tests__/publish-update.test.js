const fs = require('node:fs');
const path = require('node:path');
const {
  CHANNEL_PROFILES,
  channelTargets,
  checkProfileEnv,
  resolveProfile,
  easEnvironment,
  nativeChanges,
  parseArgs,
  easUpdateArgs,
} = require('../publish-update');

const easJson = JSON.parse(fs.readFileSync(path.join(__dirname, '../../eas.json'), 'utf8'));

describe('channels in eas.json', () => {
  it.each(Object.keys(CHANNEL_PROFILES))('channel %s is the one its profiles build on', (channel) => {
    for (const [, profile] of channelTargets(channel)) {
      expect(resolveProfile(easJson, profile).channel).toBe(channel);
    }
  });

  it('puts TestFlight and the Android APK on the uat channel, each with its own profile', () => {
    expect(channelTargets('uat')).toEqual([
      ['ios', 'testflight'],
      ['android', 'android-internal'],
    ]);
    expect(channelTargets('uat', 'android')).toEqual([['android', 'android-internal']]);
    expect(channelTargets('preview')).toEqual([
      ['ios', 'preview'],
      ['android', 'preview'],
    ]);
  });

  it('gives the testers the test API and preview the dev API, so an update never points at localhost', () => {
    for (const [, profile] of channelTargets('uat')) {
      expect(resolveProfile(easJson, profile).env.EXPO_PUBLIC_API_BASE_URL).toBe('https://api-test.rhemapod.com');
    }
    expect(resolveProfile(easJson, 'preview').env.EXPO_PUBLIC_API_BASE_URL).toBe('https://api-dev.rhemapod.com');
  });

  it('refuses a profile without an API URL, except dev clients', () => {
    expect(() => checkProfileEnv('production', resolveProfile(easJson, 'production'))).toThrow('localhost');
    expect(() => checkProfileEnv('development', resolveProfile(easJson, 'development'))).not.toThrow();
    expect(() => checkProfileEnv('testflight', resolveProfile(easJson, 'testflight'))).not.toThrow();
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
    const args = parseArgs(['--channel', 'uat', '--message', 'Fix timer', '--rollout', '10']);
    expect(args.platform).toBe('all');
    expect(easUpdateArgs({ ...args, platform: 'ios', environment: 'production' })).toEqual([
      'update', '--channel', 'uat', '--platform', 'ios', '--environment', 'production', '--message', 'Fix timer',
      '--non-interactive', '--rollout-percentage', '10',
    ]);
  });

  it('leaves out a 100% rollout', () => {
    const args = parseArgs(['--channel', 'uat', '--rollout', '100']);
    expect(easUpdateArgs({ ...args, platform: 'android', message: 'm', environment: 'preview' })).not.toContain('--rollout-percentage');
  });

  it('rejects bad input', () => {
    expect(() => parseArgs([])).toThrow('--channel must be one of');
    expect(() => parseArgs(['--channel', 'prod'])).toThrow('--channel must be one of');
    expect(() => parseArgs(['--channel', 'staging'])).toThrow('--channel must be one of');
    expect(() => parseArgs(['--channel', 'uat', '--platform', 'web'])).toThrow('--platform');
    expect(parseArgs(['--channel', 'uat', '--plan']).plan).toBe(true);
    expect(() => parseArgs(['--channel', 'uat', '--rollout', '0'])).toThrow('--rollout');
    expect(() => parseArgs(['--channel', 'uat', '--message'])).toThrow('needs a value');
    expect(() => parseArgs(['--channel', 'uat', '--yes'])).toThrow('Unknown option');
  });
});
