/**
 * Phones stay portrait; tablets rotate (tablet layouts, Nii 2026-11-21).
 *
 * `orientation: "portrait"` in app.json applies to every device, and Expo has no
 * per-device setting, so this plugin opens it up for tablets only:
 *
 * - iOS: adds `UISupportedInterfaceOrientations~ipad` with all four orientations. iPhone
 *   keeps the portrait-only `UISupportedInterfaceOrientations` Expo writes from app.json.
 *   iPad also needs all four for Split View and Slide Over.
 * - Android: there is no tablet-only manifest value, so the main activity's
 *   `android:screenOrientation` becomes "unspecified" and MainActivity locks itself to
 *   portrait when the screen's smallest width is under 600dp (a phone), before the first
 *   frame is drawn.
 *
 * User plugins run after Expo's own, so this overrides the manifest value withOrientation
 * writes. Idempotent via MARKER.
 */
const { withAndroidManifest, withInfoPlist, withMainActivity } = require('expo/config-plugins');

const MARKER = '// withTabletOrientation';
const TABLET_MIN_SMALLEST_WIDTH_DP = 600;
const IPAD_ORIENTATIONS = [
  'UIInterfaceOrientationPortrait',
  'UIInterfaceOrientationPortraitUpsideDown',
  'UIInterfaceOrientationLandscapeLeft',
  'UIInterfaceOrientationLandscapeRight',
];

function addPhonePortraitLock(mainActivity) {
  if (mainActivity.includes(MARKER)) return mainActivity;
  const superOnCreate = /^([ \t]*)super\.onCreate\(/m;
  const match = mainActivity.match(superOnCreate);
  if (!match) {
    throw new Error('withTabletOrientation: super.onCreate(...) not found in MainActivity.kt');
  }
  const indent = match[1];
  const block = [
    `${indent}${MARKER}: phones stay portrait, tablets rotate.`,
    `${indent}if (resources.configuration.smallestScreenWidthDp < ${TABLET_MIN_SMALLEST_WIDTH_DP}) {`,
    `${indent}  requestedOrientation = android.content.pm.ActivityInfo.SCREEN_ORIENTATION_PORTRAIT`,
    `${indent}}`,
    '',
  ].join('\n');
  // At the start of super.onCreate's line, so the lock is set before the first frame.
  return mainActivity.slice(0, match.index) + block + mainActivity.slice(match.index);
}

function unlockMainActivity(manifest) {
  const app = manifest.manifest.application?.[0];
  const main = app?.activity?.find((activity) => activity.$['android:name'] === '.MainActivity');
  if (!main) throw new Error('withTabletOrientation: .MainActivity not found in AndroidManifest.xml');
  main.$['android:screenOrientation'] = 'unspecified';
  return manifest;
}

function withTabletOrientation(config) {
  config = withInfoPlist(config, (cfg) => {
    cfg.modResults['UISupportedInterfaceOrientations~ipad'] = IPAD_ORIENTATIONS;
    return cfg;
  });
  config = withAndroidManifest(config, (cfg) => {
    cfg.modResults = unlockMainActivity(cfg.modResults);
    return cfg;
  });
  config = withMainActivity(config, (cfg) => {
    if (cfg.modResults.language !== 'kt') {
      throw new Error('withTabletOrientation: expected a Kotlin MainActivity');
    }
    cfg.modResults.contents = addPhonePortraitLock(cfg.modResults.contents);
    return cfg;
  });
  return config;
}

module.exports = withTabletOrientation;
module.exports.addPhonePortraitLock = addPhonePortraitLock;
module.exports.unlockMainActivity = unlockMainActivity;
module.exports.IPAD_ORIENTATIONS = IPAD_ORIENTATIONS;
