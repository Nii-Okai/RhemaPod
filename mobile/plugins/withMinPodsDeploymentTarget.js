/**
 * Raises every CocoaPods target's IPHONEOS_DEPLOYMENT_TARGET to at least
 * MIN_IOS. Xcode 26 (required by App Store Connect since the iOS 26 SDK rule)
 * rejects deployment targets below 15.0 as hard errors, and several pods'
 * privacy resource-bundle targets (GoogleSignIn, GTMAppAuth, AppAuth,
 * GTMSessionFetcher, GoogleUtilities, PromisesObjC/Swift) still declare 9–12.
 * Only raises, never lowers; idempotent via MARKER.
 */
const fs = require('fs');
const path = require('path');
const { withDangerousMod } = require('expo/config-plugins');

const MIN_IOS = '15.1';
const MARKER = '# withMinPodsDeploymentTarget';
const HOOK = 'post_install do |installer|';

function addMinDeploymentTarget(podfile) {
  if (podfile.includes(MARKER)) return podfile;
  if (!podfile.includes(HOOK)) {
    throw new Error(`withMinPodsDeploymentTarget: "${HOOK}" not found in Podfile`);
  }
  const block = [
    HOOK,
    `    ${MARKER}`,
    '    installer.pods_project.targets.each do |target|',
    '      target.build_configurations.each do |config|',
    `        if config.build_settings['IPHONEOS_DEPLOYMENT_TARGET'].to_f < ${MIN_IOS}`,
    `          config.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = '${MIN_IOS}'`,
    '        end',
    '      end',
    '    end',
  ].join('\n');
  return podfile.replace(HOOK, block);
}

function withMinPodsDeploymentTarget(config) {
  return withDangerousMod(config, [
    'ios',
    async (cfg) => {
      const file = path.join(cfg.modRequest.platformProjectRoot, 'Podfile');
      fs.writeFileSync(file, addMinDeploymentTarget(fs.readFileSync(file, 'utf8')));
      return cfg;
    },
  ]);
}

module.exports = withMinPodsDeploymentTarget;
module.exports.addMinDeploymentTarget = addMinDeploymentTarget;
module.exports.MIN_IOS = MIN_IOS;
