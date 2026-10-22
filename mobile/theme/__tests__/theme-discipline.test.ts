import fs from 'fs';
import path from 'path';

/**
 * Light mode only works if screens read the ACTIVE palette (`useTheme()` /
 * `createThemedStyles()`). Importing the static dark palette (`colors` / `darkColors`
 * from theme/colors) bypasses the theme, so it's allowed only where staying dark is the
 * design: the video surface, onboarding (art + light card in both themes), and elements
 * drawn ON sermon art (the "onArt" pins — art doesn't change brightness with the theme).
 * A new file on this list needs the same justification in its own code.
 */
const MOBILE_ROOT = path.resolve(__dirname, '..', '..');
const SCAN_DIRS = ['app', 'components', 'lib'];

const ALLOWED = new Set([
  // Whole surfaces that stay dark in both themes.
  'app/player/_player/VideoSurface.tsx',
  'app/player/_player/TransportControls.tsx',
  'app/player/_player/PlayerSeekBar.tsx',
  'app/onboarding.tsx',
  // Themed files that pin only their on-art elements to the dark palette.
  'app/(tabs)/_home/HeroCard.tsx',
  'app/(tabs)/_home/HomeTopBar.tsx',
  'app/(tabs)/_home/SpotlightCard.tsx',
  // Signature Home: the hero and countdown are dark photo frames in both themes; the shelf cards
  // pin only the chips and play buttons drawn on the art.
  'app/(tabs)/_home/signature/CountdownCard.tsx',
  'app/(tabs)/_home/signature/SignatureHeroCard.tsx',
  'app/(tabs)/_home/signature/shelfCards.tsx',
  // Signature Notifications: the latest-release card is the same dark frame as the hero.
  'app/_notifications/SignatureNotifications.tsx',
  // Signature Library: download badges and the preview chip are drawn on the art.
  'app/(tabs)/_library/signature/LibraryItems.tsx',
  'app/playlist/_detail/signature/SignatureSermonRows.tsx',
  'app/(tabs)/_downloads/DownloadRow.tsx',
  'app/(tabs)/_library/DownloadGridTile.tsx',
  'app/(tabs)/_me/ProfileAvatarPicker.tsx',
  'app/playlist/_detail/PlaylistCoverPicker.tsx',
  'app/playlist/_detail/PlaylistItemRow.tsx',
  'components/CastCloseHeader.tsx',
  'components/series/EpisodeRow.tsx',
]);

const STATIC_IMPORT = /import \{[^}]*\b(colors|darkColors)\b[^}]*\} from '[./]*theme\/colors'/;

function sources(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === 'node_modules' || entry.name === '__tests__' || entry.name.startsWith('.') ? [] : sources(full);
    }
    return /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
  });
}

describe('theme discipline', () => {
  const files = SCAN_DIRS.flatMap((d) => sources(path.join(MOBILE_ROOT, d)));

  it('only allow-listed files import the static dark palette', () => {
    const offenders = files
      .filter((f) => STATIC_IMPORT.test(fs.readFileSync(f, 'utf8')))
      .map((f) => path.relative(MOBILE_ROOT, f).split(path.sep).join('/'))
      .filter((f) => !ALLOWED.has(f));
    expect(offenders).toEqual([]);
  });

  it('keeps the allow-list honest (every entry still exists and still needs it)', () => {
    for (const rel of ALLOWED) {
      const full = path.join(MOBILE_ROOT, rel);
      expect(fs.existsSync(full)).toBe(true);
      expect(STATIC_IMPORT.test(fs.readFileSync(full, 'utf8'))).toBe(true);
    }
  });
});
