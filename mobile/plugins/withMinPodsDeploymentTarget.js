/**
 * Raises every CocoaPods target's IPHONEOS_DEPLOYMENT_TARGET to at least
 * MIN_IOS. Xcode 26 (required by App Store Connect since the iOS 26 SDK rule)
 * rejects deployment targets below 15.0 as hard errors, and several pods'
 * privacy resource-bundle targets (GoogleSignIn, GTMAppAuth, AppAuth,
 * GTMSessionFetcher, GoogleUtilities, PromisesObjC/Swift) still declare 9–12.
 * Only raises, never lowers; idempotent via MARKER.
 *
 * Also compiles the `fmt` pod as C++17: the fmt 11 bundled with React Native
 * 0.76 fails under Xcode 26's Clang with "call to consteval function
 * fmt::basic_format_string ... is not a constant expression"; consteval only
 * exists from C++20, so C++17 sidesteps it.
 */
const fs = require('fs');
const path = require('path');
const { withDangerousMod } = require('expo/config-plugins');

const MIN_IOS = '15.1';
const MARKER = '# withMinPodsDeploymentTarget';
// Must run AFTER react_native_post_install(...): it forces C++20 on every pod
// target (NewArchitectureHelper.set_clang_cxx_language_standard_if_needed),
// which would overwrite the fmt override.
const RN_HOOK_CALL = /react_native_post_install\([\s\S]*?\n\s*\)\n/;

function addMinDeploymentTarget(podfile) {
  if (podfile.includes(MARKER)) return podfile;
  const match = podfile.match(RN_HOOK_CALL);
  if (!match) {
    throw new Error(
      'withMinPodsDeploymentTarget: react_native_post_install(...) call not found in Podfile',
    );
  }
  const block = [
    '',
    `    ${MARKER}`,
    '    installer.pods_project.targets.each do |target|',
    '      target.build_configurations.each do |config|',
    `        if config.build_settings['IPHONEOS_DEPLOYMENT_TARGET'].to_f < ${MIN_IOS}`,
    `          config.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = '${MIN_IOS}'`,
    '        end',
    "        config.build_settings['CLANG_CXX_LANGUAGE_STANDARD'] = 'c++17' if target.name == 'fmt'",
    '      end',
    '    end',
    '',
  ].join('\n');
  const at = match.index + match[0].length;
  return podfile.slice(0, at) + block + podfile.slice(at);
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
