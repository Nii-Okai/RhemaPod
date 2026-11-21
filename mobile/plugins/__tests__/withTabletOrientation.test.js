const { addPhonePortraitLock, unlockMainActivity, IPAD_ORIENTATIONS } = require('../withTabletOrientation');

// Expo SDK 52's MainActivity.kt onCreate.
const MAIN_ACTIVITY = [
  'class MainActivity : ReactActivity() {',
  '  override fun onCreate(savedInstanceState: Bundle?) {',
  '    setTheme(R.style.AppTheme);',
  '    super.onCreate(null)',
  '  }',
  '}',
  '',
].join('\n');

describe('addPhonePortraitLock', () => {
  it('locks phones to portrait before super.onCreate, at its indent', () => {
    const out = addPhonePortraitLock(MAIN_ACTIVITY);
    expect(out).toContain('    if (resources.configuration.smallestScreenWidthDp < 600) {');
    expect(out).toContain('      requestedOrientation = android.content.pm.ActivityInfo.SCREEN_ORIENTATION_PORTRAIT');
    expect(out.indexOf('smallestScreenWidthDp')).toBeLessThan(out.indexOf('super.onCreate('));
    expect(out).toContain('    }\n    super.onCreate(null)');
  });

  it('is idempotent', () => {
    const once = addPhonePortraitLock(MAIN_ACTIVITY);
    expect(addPhonePortraitLock(once)).toBe(once);
  });

  it('fails loudly when onCreate has changed shape', () => {
    expect(() => addPhonePortraitLock('class MainActivity {}')).toThrow(/super.onCreate/);
  });
});

describe('unlockMainActivity', () => {
  it('sets the main activity to unspecified and leaves others alone', () => {
    const manifest = {
      manifest: {
        application: [
          {
            activity: [
              { $: { 'android:name': '.MainActivity', 'android:screenOrientation': 'portrait' } },
              { $: { 'android:name': '.Other', 'android:screenOrientation': 'portrait' } },
            ],
          },
        ],
      },
    };
    const out = unlockMainActivity(manifest);
    expect(out.manifest.application[0].activity[0].$['android:screenOrientation']).toBe('unspecified');
    expect(out.manifest.application[0].activity[1].$['android:screenOrientation']).toBe('portrait');
  });
});

describe('IPAD_ORIENTATIONS', () => {
  it('allows all four, which iPad multitasking needs', () => {
    expect(IPAD_ORIENTATIONS).toHaveLength(4);
  });
});
