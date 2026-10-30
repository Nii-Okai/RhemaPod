const { addMinDeploymentTarget, MIN_IOS } = require('../withMinPodsDeploymentTarget');

const PODFILE = [
  "target 'RhemaPod' do",
  '  post_install do |installer|',
  '    react_native_post_install(installer)',
  '  end',
  'end',
].join('\n');

describe('addMinDeploymentTarget', () => {
  it('raises pod deployment targets inside post_install, before the RN hook', () => {
    const out = addMinDeploymentTarget(PODFILE);
    expect(out).toContain(`< ${MIN_IOS}`);
    expect(out).toContain(`= '${MIN_IOS}'`);
    expect(out.indexOf('installer.pods_project.targets.each')).toBeLessThan(
      out.indexOf('react_native_post_install'),
    );
  });

  it('is idempotent', () => {
    const once = addMinDeploymentTarget(PODFILE);
    expect(addMinDeploymentTarget(once)).toBe(once);
  });

  it('fails loudly if the Podfile has no post_install hook', () => {
    expect(() => addMinDeploymentTarget("target 'X' do\nend")).toThrow(/post_install/);
  });
});
