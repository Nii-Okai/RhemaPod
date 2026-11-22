#!/usr/bin/env node
/**
 * Publishes an over-the-air update (EAS Update) to one channel, safely.
 *
 *   npm run update -- --channel uat --message "Fix the sleep timer"
 *   npm run update -- --channel uat --platform android
 *   npm run update -- --channel uat --plan     (prints update/build per platform)
 *
 * Why not plain `eas update`:
 *
 * 1. `EXPO_PUBLIC_*` values are inlined into the bundle when it is built, and
 *    `eas update` does not read the `env` of eas.json build profiles. Published
 *    without them, an update would point the app at `http://localhost:8000`. This
 *    script sets the same `env` the channel's build profile uses, and passes that
 *    profile's EAS environment so EAS environment variables (the Sentry DSN, for
 *    example) are included too.
 * 2. An update only contains JavaScript and assets. If native code changed since the
 *    builds on the channel were made (a new native package, a config plugin, a
 *    permission), the update could crash on launch. This script refuses to publish
 *    when it sees such a change; bump `expo.version` in app.json and make new builds
 *    instead (the runtime version follows the app version).
 * 3. It refuses to publish uncommitted code, so every update maps to a commit.
 *
 * The `uat` channel is the testers' channel: TestFlight (profile `testflight`) and the
 * internal Android APK (profile `android-internal`) both listen on it, and it is
 * published from the `uat` branch by .github/workflows/mobile-uat.yml. Each platform
 * is published with its own build profile's env and EAS environment, exactly as its
 * builds were made.
 *
 * Options:
 *   --channel <name>    required: development | preview | uat | production
 *   --platform <name>   ios | android | all (default all)
 *   --message <text>    defaults to the last commit's subject
 *   --rollout <1-100>   publish to only this percentage of the channel's users
 *   --plan              publish nothing; print `<platform>=update` when an update fits
 *                       the newest build, or `<platform>=build` when there is no build
 *                       for this runtime version yet. Exits 1 if native code changed
 *                       without a version bump.
 *   --dry-run           print what would run, publish nothing
 *   --force             skip the native-change and clean-tree checks
 *
 * After publishing, if SENTRY_AUTH_TOKEN is set in your shell (never commit it),
 * the update's source maps are uploaded so crash stack traces are readable.
 *
 * See mobile/docs/ota-updates.md for the tester channel, rollouts and rollback.
 */
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const MOBILE_DIR = path.resolve(__dirname, '..');

const PLATFORMS = ['ios', 'android'];

/**
 * The build profile whose builds listen on each channel, per platform (see eas.json).
 * A string means one profile for both platforms.
 */
const CHANNEL_PROFILES = {
  development: 'development',
  preview: 'preview',
  uat: { ios: 'testflight', android: 'android-internal' },
  production: 'production',
};

/** [platform, profileName] pairs to publish for a channel and a --platform choice. */
function channelTargets(channel, platform = 'all') {
  const entry = CHANNEL_PROFILES[channel];
  const platforms = platform === 'all' ? PLATFORMS : [platform];
  return platforms.map((p) => [p, typeof entry === 'string' ? entry : entry[p]]);
}

/** Paths (relative to mobile/) whose changes mean a new native build is needed. */
const NATIVE_PATHS = ['app.json', 'app.config.js', 'plugins/', 'modules/', 'patches/', 'package.json'];

/** A build profile with its `extends` chain merged, as EAS resolves it. */
function resolveProfile(easJson, name, seen = []) {
  const profile = easJson.build && easJson.build[name];
  if (!profile) throw new Error(`eas.json has no build profile "${name}"`);
  if (seen.includes(name)) throw new Error(`eas.json profile "${name}" extends itself`);
  const { extends: parentName, ...own } = profile;
  if (!parentName) return own;
  const parent = resolveProfile(easJson, parentName, [...seen, name]);
  const merged = { ...parent, ...own, env: { ...parent.env, ...own.env } };
  for (const platform of ['ios', 'android']) {
    if (parent[platform] || own[platform]) merged[platform] = { ...parent[platform], ...own[platform] };
  }
  return merged;
}

/** The EAS environment a profile's builds get, by EAS's own default when unset. */
function easEnvironment(profile) {
  if (profile.environment) return profile.environment;
  if (profile.developmentClient) return 'development';
  if (profile.distribution === 'internal') return 'preview';
  return 'production';
}

/**
 * Which changed files need a new native build. `package.json` counts only when its
 * `dependencies` changed (scripts and devDependencies never reach the app's native
 * side); app.json counts for any change.
 */
function nativeChanges(changedFiles, oldPackageJson, newPackageJson) {
  return changedFiles.filter((file) => {
    if (file === 'package.json') {
      const before = JSON.stringify((oldPackageJson && oldPackageJson.dependencies) || {});
      const after = JSON.stringify((newPackageJson && newPackageJson.dependencies) || {});
      return before !== after;
    }
    return NATIVE_PATHS.some((p) => (p.endsWith('/') ? file.startsWith(p) : file === p));
  });
}

function parseArgs(argv) {
  const args = { dryRun: false, force: false, plan: false, platform: 'all' };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = () => {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) throw new Error(`${arg} needs a value`);
      i += 1;
      return next;
    };
    if (arg === '--channel') args.channel = value();
    else if (arg === '--message') args.message = value();
    else if (arg === '--rollout') args.rollout = Number(value());
    else if (arg === '--platform') args.platform = value();
    else if (arg === '--plan') args.plan = true;
    else if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--force') args.force = true;
    else throw new Error(`Unknown option ${arg}`);
  }
  if (!args.channel || !CHANNEL_PROFILES[args.channel]) {
    throw new Error(`--channel must be one of: ${Object.keys(CHANNEL_PROFILES).join(', ')}`);
  }
  if (!['all', ...PLATFORMS].includes(args.platform)) {
    throw new Error('--platform must be one of: ios, android, all');
  }
  if (args.rollout !== undefined && !(Number.isInteger(args.rollout) && args.rollout >= 1 && args.rollout <= 100)) {
    throw new Error('--rollout must be a whole number from 1 to 100');
  }
  return args;
}

/** The arguments for `eas update`. */
function easUpdateArgs({ channel, platform, message, rollout, environment }) {
  const args = ['update', '--channel', channel, '--platform', platform, '--environment', environment, '--message', message, '--non-interactive'];
  if (rollout !== undefined && rollout < 100) args.push('--rollout-percentage', String(rollout));
  return args;
}

function git(args) {
  return execFileSync('git', args, { cwd: MOBILE_DIR, encoding: 'utf8' }).trim();
}

function eas(args, options = {}) {
  return spawnSync('npx', ['--yes', 'eas-cli', ...args], { cwd: MOBILE_DIR, encoding: 'utf8', ...options });
}

/** The newest finished build on the channel for this platform and runtime version, if any. */
function latestBuild(channel, platform, runtimeVersion) {
  const result = eas(
    [
      'build:list', '--channel', channel, '--platform', platform, '--runtime-version', runtimeVersion,
      '--status', 'finished', '--limit', '1', '--json', '--non-interactive',
    ],
    { stdio: ['ignore', 'pipe', 'inherit'] },
  );
  if (result.status !== 0) throw new Error('Could not list builds (are you logged in? `npx eas-cli login`)');
  const builds = JSON.parse(result.stdout);
  return builds[0];
}

/**
 * Throws if native-side files changed since the newest build on the channel for this
 * platform and runtime version. Returns that build, or null when there is none.
 */
function nativeCheck(channel, platform, runtimeVersion) {
  const build = latestBuild(channel, platform, runtimeVersion);
  if (!build) return null;
  const label = `${platform} "${channel}"`;
  const commit = build.gitCommitHash;
  if (!commit) throw new Error(`The latest ${label} build has no git commit recorded; check by hand and use --force.`);
  try {
    git(['cat-file', '-e', `${commit}^{commit}`]);
  } catch {
    throw new Error(`Commit ${commit} of the latest ${label} build is not in this clone; run \`git fetch\` first.`);
  }
  const changed = git(['diff', '--name-only', '--relative', commit, 'HEAD', '--', '.']).split('\n').filter(Boolean);
  let oldPackageJson = null;
  try {
    oldPackageJson = JSON.parse(git(['show', `${commit}:./package.json`]));
  } catch {
    oldPackageJson = null;
  }
  const newPackageJson = JSON.parse(fs.readFileSync(path.join(MOBILE_DIR, 'package.json'), 'utf8'));
  const native = nativeChanges(changed, oldPackageJson, newPackageJson);
  if (native.length) {
    throw new Error(
      `Native-side files changed since the ${label} build (${commit.slice(0, 8)}):\n  ${native.join('\n  ')}\n` +
        'An update cannot carry these. Bump expo.version in app.json and make new builds, ' +
        'or, if you are sure every change is JavaScript-only, rerun with --force.',
    );
  }
  return build;
}

function checkNativeUnchanged(channel, platform, runtimeVersion) {
  const build = nativeCheck(channel, platform, runtimeVersion);
  if (!build) {
    throw new Error(
      `No finished ${platform} build on "${channel}" has runtime version ${runtimeVersion}, so this update would reach nobody. ` +
        'Make a build with the matching profile first.',
    );
  }
  return build;
}

/** Build-time values an update must carry, or it would point the app at localhost. */
function checkProfileEnv(profileName, profile) {
  if (profile.developmentClient) return; // dev clients read mobile/.env
  if (!profile.env || !profile.env.EXPO_PUBLIC_API_BASE_URL) {
    throw new Error(`eas.json profile "${profileName}" sets no EXPO_PUBLIC_API_BASE_URL, so an update would point the app at localhost.`);
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const easJson = JSON.parse(fs.readFileSync(path.join(MOBILE_DIR, 'eas.json'), 'utf8'));
  const appJson = JSON.parse(fs.readFileSync(path.join(MOBILE_DIR, 'app.json'), 'utf8'));
  const runtimeVersion = appJson.expo.version;
  const targets = channelTargets(args.channel, args.platform).map(([platform, profileName]) => {
    const profile = resolveProfile(easJson, profileName);
    if (profile.channel !== args.channel) {
      throw new Error(`eas.json profile "${profileName}" is on channel "${profile.channel}", not "${args.channel}"`);
    }
    checkProfileEnv(profileName, profile);
    return { platform, profileName, profile, environment: easEnvironment(profile) };
  });

  if (args.plan) {
    for (const { platform } of targets) {
      const build = nativeCheck(args.channel, platform, runtimeVersion);
      console.log(`${platform}=${build ? 'update' : 'build'}`);
    }
    return;
  }

  if (!args.force) {
    if (git(['status', '--porcelain', '--', '.'])) throw new Error('Commit or stash your changes first (or use --force).');
    if (!args.dryRun) {
      for (const { platform } of targets) checkNativeUnchanged(args.channel, platform, runtimeVersion);
    }
  }

  const message = args.message || git(['log', '-1', '--format=%s']);
  for (const { platform, profileName, profile, environment } of targets) {
    const easArgs = easUpdateArgs({ channel: args.channel, platform, message, rollout: args.rollout, environment });
    const env = { ...process.env, ...profile.env };

    console.log(`\n${platform}: channel ${args.channel} (profile ${profileName}, EAS environment ${environment}, runtime ${runtimeVersion})`);
    console.log(`Build-time env from eas.json: ${Object.keys(profile.env || {}).join(', ') || 'none'}`);
    console.log(`eas ${easArgs.map((a) => (a.includes(' ') ? JSON.stringify(a) : a)).join(' ')}`);
    if (args.dryRun) continue;

    const published = eas(easArgs, { env, stdio: 'inherit' });
    if (published.status !== 0) process.exit(published.status || 1);

    if (process.env.SENTRY_AUTH_TOKEN) {
      const upload = spawnSync('npx', ['sentry-expo-upload-sourcemaps', 'dist'], { cwd: MOBILE_DIR, env, stdio: 'inherit' });
      if (upload.status !== 0) console.warn('Update published, but uploading source maps to Sentry failed.');
    } else {
      console.log('SENTRY_AUTH_TOKEN not set: source maps were not uploaded to Sentry.');
    }
  }
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`\n${error.message}\n`);
    process.exit(1);
  }
}

module.exports = { CHANNEL_PROFILES, channelTargets, checkProfileEnv, resolveProfile, easEnvironment, nativeChanges, parseArgs, easUpdateArgs };
