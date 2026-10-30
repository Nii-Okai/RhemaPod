const { addMinDeploymentTarget, MIN_IOS } = require('../withMinPodsDeploymentTarget');

const PODFILE = [
  "target 'RhemaPod' do",
  '  post_install do |installer|',
  '    react_native_post_install(',
  '      installer,',
  "      config[:reactNativePath],",
  '      :mac_catalyst_enabled => false,',
  '    )',
  '',
  '    installer.target_installation_results.pod_target_installation_results',
  '  end',
  'end',
  '',
].join('\n');

describe('addMinDeploymentTarget', () => {
  it('raises pod deployment targets AFTER the RN hook (which forces C++20 on every pod)', () => {
    const out = addMinDeploymentTarget(PODFILE);
    expect(out).toContain(`< ${MIN_IOS}`);
    expect(out).toContain(`= '${MIN_IOS}'`);
    expect(out.indexOf('installer.pods_project.targets.each')).toBeGreaterThan(
      out.indexOf('react_native_post_install('),
    );
    expect(out.indexOf('installer.pods_project.targets.each')).toBeLessThan(
      out.indexOf('pod_target_installation_results'),
    );
  });

  it('compiles only the fmt pod as C++17', () => {
    expect(addMinDeploymentTarget(PODFILE)).toContain(
      "config.build_settings['CLANG_CXX_LANGUAGE_STANDARD'] = 'c++17' if target.name == 'fmt'",
    );
  });

  it('is idempotent', () => {
    const once = addMinDeploymentTarget(PODFILE);
    expect(addMinDeploymentTarget(once)).toBe(once);
  });

  it('fails loudly if the Podfile has no react_native_post_install call', () => {
    expect(() => addMinDeploymentTarget("target 'X' do\nend")).toThrow(/react_native_post_install/);
  });
});
